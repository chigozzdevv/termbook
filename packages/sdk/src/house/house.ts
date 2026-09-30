import type { TermbookClient } from "../client/client.js";
import type { HouseSummary, DepositArgs, HouseAccountSummary, HouseDepositResult, WithdrawalView } from "../types/house.types.js";
import type { ActivityCallback, Unsubscribe, TxHash } from "../types/client.types.js";
import type { HouseActivity } from "../types/house.types.js";
import { houseVaultAbi } from "@termbook/bindings";
import { localPayment, savedLocalPayment, type LocalPaymentCheckpoint } from "../settlement/local-payment.js";
import { remotePayment, savedPayment } from "../settlement/payment.js";
import type { PaymentCheckpoint, PaymentOptions } from "../settlement/payment-types.js";
import { parseEventLogs } from "viem";

export class House {
  client: TermbookClient;
  id: `0x${string}`;

  constructor(client: TermbookClient, id: `0x${string}`) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(id)) throw new Error("param-invalid");
    this.client = client;
    this.id = id;
  }

  async summary(): Promise<HouseSummary> {
    await this.client.ready();
    const [asset, sharePrice] = await Promise.all([
      this.client.rpc.read<`0x${string}`>(this.id, houseVaultAbi, "asset"),
      this.client.rpc.vaultSharePrice(this.id),
    ]);
    return { id: this.id, vault: this.id, asset, sharePrice };
  }

  async activity(): Promise<HouseActivity[]> {
    await this.client.ready();
    return this.client.rpc.houseActivity(this.id);
  }

  async integrations(filters?: { active?: boolean }): Promise<unknown[]> {
    const rows = await this.client.catalog.integrations({ house: this.id });
    if (filters?.active === undefined) return rows;
    return rows.filter((row) => Boolean((row as Record<string, unknown>)["active"]) === filters.active);
  }

  subscribe(callback: ActivityCallback, intervalMs = 5_000): Unsubscribe {
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error("param-invalid");
    let active = true;
    let fingerprint = "";
    const poll = async () => {
      try {
        const events = await this.activity();
        const next = events.map((event) => `${event.event}:${event.transactionHash ?? ""}:${event.logIndex ?? ""}`).join("|");
        if (active && next !== fingerprint) {
          fingerprint = next;
          callback(events);
        }
      } catch {
        if (active) return;
      }
    };
    void poll();
    const timers = globalThis as unknown as { setInterval: (callback: () => void, delay: number) => unknown; clearInterval: (timer: unknown) => void };
    const timer = timers.setInterval(() => void poll(), intervalMs);
    return () => {
      active = false;
      timers.clearInterval(timer);
    };
  }

  async deposit(args: DepositArgs, options: PaymentOptions = {}): Promise<HouseDepositResult> {
    await this.client.ready();
    const pending = options.localCheckpoint ?? savedLocalPayment(this.client, { kind: "deposit", chainId: this.client.config.chainId,
      target: this.id, payer: this.client.signer.address() });
    if (pending && (options.localCheckpoint || pending.stage !== "complete")) return this.resumeLocalDeposit(pending, options);
    if (args.source) return this.account().deposit(args, options);
    if (args.amount <= 0n || args.minShares < 0n || args.deadline <= Math.floor(Date.now() / 1000)) throw new Error("param-invalid");
    const asset = await this.client.rpc.read<`0x${string}`>(this.id, houseVaultAbi, "asset");
    const [price, totalShares] = await Promise.all([
      this.client.rpc.vaultSharePrice(this.id),
      this.client.rpc.read<bigint>(this.id, houseVaultAbi, "totalShares"),
    ]);
    const shares = totalShares === 0n ? args.amount : args.amount * 1_000_000_000_000_000_000n / price;
    if (shares < args.minShares || shares === 0n) throw new Error("slippage");
    const result = await localPayment(this.client, { kind: "deposit", chainId: this.client.config.chainId,
      payer: this.client.signer.address(), target: this.id, token: asset, amount: String(args.amount),
      minShares: String(args.minShares), deadline: args.deadline, stage: "reviewed" }, options);
    return { shares: result.shares, status: "applied", tx: result.tx, localCheckpoint: result.checkpoint };
  }

  async resumeLocalDeposit(checkpoint: LocalPaymentCheckpoint, options: PaymentOptions = {}): Promise<HouseDepositResult> {
    if (checkpoint.kind !== "deposit" || checkpoint.target.toLowerCase() !== this.id.toLowerCase()) throw new Error("payment-checkpoint-invalid");
    const result = await localPayment(this.client, checkpoint, { ...options, localCheckpoint: checkpoint });
    return { shares: result.shares, status: "applied", tx: result.tx, localCheckpoint: result.checkpoint };
  }

  account(owner: `0x${string}` = this.client.signer.address()): HouseAccount {
    if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) throw new Error("param-invalid");
    return new HouseAccount(this, owner);
  }
}

export class HouseAccount {
  constructor(private readonly house: House, readonly owner: `0x${string}`) {}

  async summary(): Promise<HouseAccountSummary> {
    await this.house.client.ready();
    const [shares, sharePrice] = await Promise.all([
      this.house.client.rpc.vaultShares(this.house.id, this.owner),
      this.house.client.rpc.vaultSharePrice(this.house.id),
    ]);
    return { owner: this.owner, shares, sharePrice, assets: shares * sharePrice / 1_000_000_000_000_000_000n };
  }

  async deposit(args: DepositArgs, options: PaymentOptions = {}): Promise<HouseDepositResult> {
    await this.house.client.ready();
    if (this.owner.toLowerCase() !== this.house.client.signer.address().toLowerCase()) throw new Error("deposit-owner-wallet-required");
    if (options.checkpoint) return this.resumeDeposit(options.checkpoint, options);
    const remote = savedPayment(this.house.client, { kind: "lp_deposit", vault: this.house.id });
    if (remote && remote.stage !== "complete") {
      if (!args.source) throw new Error("payment-already-pending");
      return this.resumeDeposit(remote, options);
    }
    if (args.source) {
      if (args.source.provider !== "aurora_intents" || args.source.maxAmountIn <= 0n || args.source.chainId <= 0) throw new Error("settlement-route-required");
      const asset = await this.house.client.rpc.read<`0x${string}`>(this.house.id, houseVaultAbi, "asset");
      const outcome = await remotePayment(this.house.client, { kind: "lp_deposit", payer: this.owner,
        vault: this.house.id, token: asset, amount: String(args.amount), minShares: String(args.minShares), deadline: args.deadline,
        source: { ...args.source, maxAmountIn: String(args.source.maxAmountIn), maxReceived: String(args.source.maxReceived) },
      }, options);
      return { shares: outcome.shares, status: outcome.status === "refunded" ? "refunded" : "applied",
        refunded: outcome.refunded, sourceRefunded: outcome.sourceRefunded, checkpoint: outcome.checkpoint,
        registration: outcome.registration, ...(outcome.registration ?? {}) };
    }

    return this.house.deposit(args, options);
  }

  async resumeLocalDeposit(checkpoint: LocalPaymentCheckpoint, options: PaymentOptions = {}): Promise<HouseDepositResult> {
    if (checkpoint.payer.toLowerCase() !== this.owner.toLowerCase()) throw new Error("payment-checkpoint-invalid");
    return this.house.resumeLocalDeposit(checkpoint, options);
  }

  async resumeDeposit(checkpoint: PaymentCheckpoint, options: Omit<PaymentOptions, "checkpoint"> = {}): Promise<HouseDepositResult> {
    if (checkpoint.input.kind !== "lp_deposit" || checkpoint.input.vault.toLowerCase() !== this.house.id.toLowerCase()
      || checkpoint.input.payer.toLowerCase() !== this.owner.toLowerCase()) throw new Error("payment-checkpoint-invalid");
    const outcome = await remotePayment(this.house.client, checkpoint.input, { ...options, checkpoint });
    return { shares: outcome.shares, status: outcome.status === "refunded" ? "refunded" : "applied",
      refunded: outcome.refunded, sourceRefunded: outcome.sourceRefunded, checkpoint: outcome.checkpoint,
      registration: outcome.registration, ...(outcome.registration ?? {}) };
  }

  async withdraw(args: { amount: bigint; to?: `0x${string}` }): Promise<{ amount: bigint; tx: TxHash }> {
    await this.house.client.ready();
    if (args.amount <= 0n) throw new Error("param-invalid");
    const to = args.to ?? this.owner;
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("recipient-invalid");
    const sharePrice = await this.house.client.rpc.vaultSharePrice(this.house.id);
    const shares = args.amount * 1_000_000_000_000_000_000n / sharePrice;
    if (shares <= 0n) throw new Error("param-invalid");
    const amount = shares * sharePrice / 1_000_000_000_000_000_000n;
    const freeCash = await this.house.client.rpc.read<bigint>(this.house.id, houseVaultAbi, "availableCash");
    const functionName = amount <= freeCash ? "requestWithdrawTo" : "requestWithdrawQueued";
    const argsForCall = functionName === "requestWithdrawTo" ? [shares, to] : [shares, to];
    const tx = await this.house.client.rpc.write(this.house.id, houseVaultAbi, functionName, argsForCall);
    await this.house.client.rpc.wait(tx);
    return { amount, tx };
  }

  async withdrawals(): Promise<WithdrawalView[]> {
    await this.house.client.ready();
    const count = await this.house.client.rpc.read<bigint>(this.house.id, houseVaultAbi, "withdrawalNonce");
    const limit = count > 100n ? 100n : count;
    const records: WithdrawalView[] = [];
    for (let id = 1n; id <= limit; id += 1n) {
      const row = await this.house.client.rpc.read<readonly unknown[]>(this.house.id, houseVaultAbi, "withdrawals", [id]);
      const owner = row[0];
      if (typeof owner !== "string" || owner.toLowerCase() !== this.owner.toLowerCase()) continue;
      records.push({
        id,
        owner: owner as `0x${string}`,
        recipient: row[1] as `0x${string}`,
        shares: BigInt(String(row[2])),
        amount: BigInt(String(row[3])),
        claimed: Boolean(row[4]),
        cancelled: Boolean(row[5]),
      });
    }
    return records;
  }

  async claim(withdrawalId: string): Promise<{ amount: bigint; tx: TxHash }> {
    await this.house.client.ready();
    if (!/^\d+$/.test(withdrawalId)) throw new Error("param-invalid");
    const id = BigInt(withdrawalId);
    const row = await this.house.client.rpc.read<readonly unknown[]>(this.house.id, houseVaultAbi, "withdrawals", [id]);
    const owner = row[0];
    if (typeof owner !== "string" || owner.toLowerCase() !== this.owner.toLowerCase()) throw new Error("unauthorized");
    if (Boolean(row[4]) || Boolean(row[5])) throw new Error("withdrawal-unavailable");
    const tx = await this.house.client.rpc.write(this.house.id, houseVaultAbi, "claimWithdrawal", [id]);
    const receipt = await this.house.client.rpc.wait(tx);
    const events = parseEventLogs({ abi: houseVaultAbi, eventName: "WithdrawalClaimed",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === this.house.id.toLowerCase()) });
    const claimed = events.find((event) => event.args.withdrawalId === id);
    if (!claimed) throw new Error("withdrawal-receipt-missing");
    const amount = claimed.args.amount;
    return { amount, tx };
  }

  async cancel_withdrawal(withdrawalId: string): Promise<{ tx: TxHash }> {
    await this.house.client.ready();
    if (!/^\d+$/.test(withdrawalId)) throw new Error("param-invalid");
    const tx = await this.house.client.rpc.write(this.house.id, houseVaultAbi, "cancelWithdrawal", [BigInt(withdrawalId)]);
    await this.house.client.rpc.wait(tx);
    return { tx };
  }
}
