import type { TermbookClient } from "../client/client.js";
import type { HouseSummary, DepositArgs, HouseAccountSummary, HouseDepositResult, WithdrawalView } from "../types/house.types.js";
import type { ActivityCallback, Unsubscribe, TxHash } from "../types/client.types.js";
import type { HouseActivity } from "../types/house.types.js";
import { houseVaultAbi } from "@termbook/bindings";
import { settlementNonce } from "../settlement/settlement.js";
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

  async deposit(args: DepositArgs): Promise<HouseDepositResult> {
    await this.client.ready();
    if (args.amount <= 0n || args.minShares < 0n || args.deadline <= Math.floor(Date.now() / 1000)) throw new Error("param-invalid");
    const asset = await this.client.rpc.read<`0x${string}`>(this.id, houseVaultAbi, "asset");
    const [price, totalShares] = await Promise.all([
      this.client.rpc.vaultSharePrice(this.id),
      this.client.rpc.read<bigint>(this.id, houseVaultAbi, "totalShares"),
    ]);
    const shares = totalShares === 0n ? args.amount : args.amount * 1_000_000_000_000_000_000n / price;
    if (shares < args.minShares || shares === 0n) throw new Error("slippage");
    const approvalTx = await this.client.rpc.approve(asset, this.id, args.amount);
    await this.client.rpc.wait(approvalTx);
    const tx = await this.client.rpc.write(this.id, houseVaultAbi, "depositBound", [this.client.signer.address(), args.amount, args.minShares, BigInt(args.deadline)]);
    await this.client.rpc.wait(tx);
    return { shares, status: "submitted", tx };
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

  async deposit(args: DepositArgs): Promise<HouseDepositResult> {
    await this.house.client.ready();
    if (this.owner.toLowerCase() !== this.house.client.signer.address().toLowerCase()) throw new Error("deposit-owner-wallet-required");
    if (args.source) {
      if (args.source.provider !== "aurora_intents" || args.source.maxAmountIn <= 0n || args.source.chainId <= 0) throw new Error("settlement-route-required");
      const asset = await this.house.client.rpc.read<`0x${string}`>(this.house.id, houseVaultAbi, "asset");
      const operation = await this.house.client.settlement.register({
        kind: "lp_deposit",
        payer: this.owner,
        nonce: settlementNonce(),
        chainId: args.source.chainId,
        routeId: args.source.routeId,
        routeVersion: args.source.routeVersion,
        asset: args.source.asset,
        settlementAsset: asset,
        vault: this.house.id,
        maxAmountIn: args.source.maxAmountIn,
        maxReceived: args.source.maxReceived,
        minAmountOut: args.amount,
        deadline: args.deadline,
        sourceRefund: args.source.sourceRefund,
        monadRefund: args.source.monadRefund,
        lpRecipient: this.owner,
        minShares: args.minShares,
      });
      return { shares: 0n, status: "pending", registration: operation, ...operation };
    }
    return this.house.deposit(args);
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
