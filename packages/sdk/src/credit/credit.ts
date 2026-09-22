import type { TermbookClient } from "../client/client.js";
import type { AppAction } from "../types/app.types.js";
import type { ActivityCallback, Unsubscribe } from "../types/client.types.js";
import type { CreditActivity, CreditSummary, ExecuteResult } from "../types/credit.types.js";
import type { RepayArgs, RepayResult } from "../types/settlement.types.js";
import { CreditApp } from "../app/app.js";
import { CreditAccount } from "../account/account.js";
import { CreditCollateral } from "../collateral/collateral.js";
import { houseVaultAbi, termbookCoreAbi } from "@termbook/bindings";

const facilities = [
  "reserved", "collateral_locking", "collateral_proving", "account_creating", "ready",
  "closing", "closed", "aborted", "liquidating", "recovery_pending", "liquidated",
] as const;

const payments = ["undrawn", "current", "matured", "defaulted", "repaid"] as const;

function field(details: Record<string, unknown>, key: string, index: number): unknown {
  return Array.isArray(details) ? details[index] : details[key];
}

function asBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(String(value ?? 0));
}

function asAddress(value: unknown): `0x${string}` | undefined {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) ? value as `0x${string}` : undefined;
}

export class Credit {
  client: TermbookClient;
  id: `0x${string}`;
  app: CreditApp;
  account: CreditAccount;
  collateral: CreditCollateral;

  constructor(client: TermbookClient, id: `0x${string}`) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("param-invalid");
    this.client = client;
    this.id = id;
    this.app = new CreditApp(client, id);
    this.account = new CreditAccount(client, id);
    this.collateral = new CreditCollateral(client, id);
  }

  async details(): Promise<Record<string, unknown>> {
    return this.client.rpc.creditDetails(this.id);
  }

  async summary(): Promise<CreditSummary> {
    const details = await this.details();
    const facility = Number(field(details, "facility", 0));
    const payment = Number(field(details, "payment", 1));
    return {
      id: this.id,
      facility: facilities[facility] ?? "unknown",
      payment: payments[payment] ?? "unknown",
      limit: asBigInt(field(details, "limit", 10)),
      debt: asBigInt(field(details, "debt", 11)),
      revision: asBigInt(field(details, "revision", 17)),
      account: asAddress(field(details, "account", 5)),
      vault: asAddress(field(details, "vault", 4)),
    };
  }

  async activity(): Promise<CreditActivity[]> {
    return this.client.rpc.creditActivity(this.id);
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

  async execute(action: AppAction): Promise<ExecuteResult> {
    return this.app.execute(action);
  }

  async repay(args: RepayArgs): Promise<RepayResult> {
    if (args.amount !== "max" && args.amount <= 0n) throw new Error("param-invalid");
    const details = await this.details();
    const vault = asAddress(field(details, "vault", 4));
    if (!vault) throw new Error("credit-unavailable");
    const asset = await this.client.rpc.read<`0x${string}`>(vault, houseVaultAbi, "asset");
    const debt = asBigInt(field(details, "debt", 11));
    const requested = args.amount === "max" ? debt : args.amount;
    const applied = requested > debt ? debt : requested;
    if (applied === 0n) return { applied: 0n, remaining: debt, status: debt === 0n ? "applied" : "partial" };
    if (args.from === "aurora_intents") {
      if (!args.source || args.source.maxAmountIn <= 0n || args.source.maxAmountIn < applied) throw new Error("settlement-route-required");
      const operationId = await this.client.settlement.register({
        kind: "repay",
        payer: this.client.signer.address(),
        nonce: BigInt(Math.floor(Date.now() / 1000)),
        chainId: args.source.chainId,
        creditId: this.id,
        asset: args.source.asset,
        settlementAsset: asset,
        vault,
        maxAmountIn: args.source.maxAmountIn,
        minAmountOut: applied,
        deadline: Math.floor(Date.now() / 1000) + 900,
        sourceRefund: args.source.sourceRefund,
        monadRefund: args.source.monadRefund,
      });
      return { applied: 0n, remaining: debt, status: "pending", operationId };
    }
    if (args.from === "credit_account") {
      const account = asAddress(field(details, "account", 5));
      if (!account) throw new Error("account-unavailable");
      const balance = await this.client.rpc.creditAccountTokenBalance(account, asset);
      if (balance < applied) throw new Error("settle-failed");
      const tx = await this.client.rpc.coreWrite("repayFromAccount", [this.id, applied]);
      await this.client.rpc.wait(tx);
      const remaining = await this.client.rpc.debt(this.id);
      return { applied, remaining, status: remaining === 0n ? "applied" : "partial", tx };
    }
    const approvalTx = await this.client.rpc.approve(asset, this.client.config.core, applied);
    await this.client.rpc.wait(approvalTx);
    const tx = await this.client.rpc.coreWrite("repay", [this.id, applied]);
    await this.client.rpc.wait(tx);
    const remaining = await this.client.rpc.debt(this.id);
    return { applied, remaining, status: remaining === 0n ? "applied" : "partial", tx };
  }

  async close(): Promise<{ closed: boolean; tx?: `0x${string}` }> {
    const before = await this.details();
    const facility = Number(field(before, "facility", 0));
    if (facility !== 4 && facility !== 5) throw new Error("recovery-blocked");
    const vault = asAddress(field(before, "vault", 4));
    const account = asAddress(field(before, "account", 5));
    const debt = asBigInt(field(before, "debt", 11));
    if (debt > 0n) {
      if (!vault || !account) throw new Error("settle-failed");
      const asset = await this.client.rpc.read<`0x${string}`>(vault, houseVaultAbi, "asset");
      const balance = await this.client.rpc.creditAccountTokenBalance(account, asset);
      if (balance < debt) throw new Error("settle-failed");
      const repayTx = await this.client.rpc.coreWrite("repayFromAccount", [this.id, debt]);
      await this.client.rpc.wait(repayTx);
    }
    if (facility === 4) {
      const startTx = await this.client.rpc.coreWrite("startClosing", [this.id]);
      await this.client.rpc.wait(startTx);
    }
    const current = await this.details();
    const currentVault = asAddress(field(current, "vault", 4));
    const currentAccount = asAddress(field(current, "account", 5));
    if (currentVault && currentAccount) {
      const asset = await this.client.rpc.read<`0x${string}`>(currentVault, houseVaultAbi, "asset");
      const surplus = await this.client.rpc.creditAccountTokenBalance(currentAccount, asset);
      if (surplus > 0n) {
        const healthTx = await this.client.rpc.coreWrite("recordHealth", [this.id]);
        await this.client.rpc.wait(healthTx);
        const surplusTx = await this.client.rpc.coreWrite("withdraw", [this.id, asset, this.client.signer.address(), surplus]);
        await this.client.rpc.wait(surplusTx);
      }
    }
    const remote = await this.client.rpc.read<boolean>(this.client.config.core, termbookCoreAbi, "remoteCollateral", [this.id]);
    const pendingRemote = remote ? await this.client.rpc.read<bigint>(this.client.config.core, termbookCoreAbi, "pendingRemoteReturn", [this.id]) : 0n;
    const lock = field(current, "lockId", 22);
    const collateralAmount = asBigInt(field(current, "collateralAmount", 9));
    const collateralReturned = Boolean(field(current, "collateralReturned", 24));
    if (typeof lock === "string" && /^0x[a-fA-F0-9]{64}$/.test(lock) && collateralAmount > 0n) {
      if (remote && pendingRemote > 0n) return { closed: false };
      const returnTx = await this.client.rpc.coreWrite("authorizeReturn", [this.id, lock, collateralAmount]);
      await this.client.rpc.wait(returnTx);
      if (remote) return { closed: false, tx: returnTx };
    } else if (!collateralReturned && typeof lock === "string" && /^0x[a-fA-F0-9]{64}$/.test(lock)) {
      throw new Error("collateral-return-required");
    }
    const finishTx = await this.client.rpc.coreWrite("finishClose", [this.id]);
    await this.client.rpc.wait(finishTx);
    return { closed: true, tx: finishTx };
  }
}
