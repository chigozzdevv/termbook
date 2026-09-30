import type { TermbookClient } from "../client/client.js";
import type { AppAction } from "../types/app.types.js";
import type { ActivityCallback, Unsubscribe } from "../types/client.types.js";
import type { CreditActivity, CreditSummary, ExecuteResult } from "../types/credit.types.js";
import type { RepayArgs, RepayResult } from "../types/settlement.types.js";
import { settlementNonce } from "../settlement/settlement.js";
import { CreditApp } from "../app/app.js";
import { CreditAccount } from "../account/account.js";
import { CreditCollateral } from "../collateral/collateral.js";
import type { CollateralSetup } from "../collateral/setup.js";
import { houseVaultAbi } from "@termbook/bindings";
import { decodeFunctionData, parseAbi } from "viem";
import { closeCredit, type CloseOptions } from "./closure.js";
const clearanceAbi = parseAbi(["function confirmRemoteRecoveryClearance(bytes32,bytes,bytes)"]);

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
  setup?: CollateralSetup;

  constructor(client: TermbookClient, id: `0x${string}`) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("param-invalid");
    this.client = client;
    this.id = id;
    this.app = new CreditApp(client, id);
    this.account = new CreditAccount(client, id);
    this.collateral = new CreditCollateral(client, id);
  }

  async details(): Promise<Record<string, unknown>> {
    await this.client.ready();
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
    await this.client.ready();
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
      if (!args.source || args.source.maxAmountIn <= 0n) throw new Error("settlement-route-required");
      const operation = await this.client.settlement.register({
        kind: "repay",
        payer: this.client.signer.address(),
        nonce: settlementNonce(),
        chainId: args.source.chainId,
        routeId: args.source.routeId,
        routeVersion: args.source.routeVersion,
        creditId: this.id,
        asset: args.source.asset,
        settlementAsset: asset,
        vault,
        maxAmountIn: args.source.maxAmountIn,
        maxReceived: args.source.maxReceived,
        minAmountOut: applied,
        deadline: Math.floor(Date.now() / 1000) + 900,
        sourceRefund: args.source.sourceRefund,
        monadRefund: args.source.monadRefund,
      });
      return { applied: 0n, remaining: debt, status: "pending", registration: operation, ...operation };
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

  async close(options: CloseOptions = {}): Promise<{ closed: true; tx?: `0x${string}` }> {
    return closeCredit(this.client, this.id, options);
  }

  async confirmRecoveryClearance(sourceTx?: string): Promise<{ tx: `0x${string}` }> {
    const plan = await this.client.authenticatedPost<{ to: string; data: `0x${string}`; chainId: number }>(
      "/recovery/clearance/plan", { creditId: this.id, ...(sourceTx ? { sourceTx } : {}) });
    const decoded = decodeFunctionData({ abi: clearanceAbi, data: plan.data });
    if (plan.to.toLowerCase() !== this.client.config.core.toLowerCase() || plan.chainId !== this.client.config.chainId
      || decoded.functionName !== "confirmRemoteRecoveryClearance" || decoded.args[0].toLowerCase() !== this.id.toLowerCase()) {
      throw new Error("recovery-clearance-plan-invalid");
    }
    const tx = await this.client.rpc.coreWrite(decoded.functionName, decoded.args);
    await this.client.rpc.wait(tx);
    return { tx };
  }
}
