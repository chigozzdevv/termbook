import type { TermbookClient } from "../client/client.js";
import type { AppAction } from "../types/app.types.js";
import type { ActivityCallback, Unsubscribe } from "../types/client.types.js";
import type { CreditActivity, CreditSummary, ExecuteResult, ExecuteOptions } from "../types/credit.types.js";
import type { RepayArgs, RepayResult } from "../types/settlement.types.js";
import { localPayment, savedLocalPayment, type LocalPaymentCheckpoint } from "../settlement/local-payment.js";
import { remotePayment, savedPayment } from "../settlement/payment.js";
import type { PaymentCheckpoint, PaymentOptions } from "../settlement/payment-types.js";
import { CreditApp } from "../app/app.js";
import { CreditAccount } from "../account/account.js";
import { CreditCollateral } from "../collateral/collateral.js";
import type { CollateralSetup } from "../collateral/setup.js";
import { houseVaultAbi, termbookCoreAbi } from "@termbook/bindings";
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
      debt: await this.client.rpc.debt(this.id),
      revision: asBigInt(field(details, "revision", 17)),
      account: asAddress(field(details, "account", 5)),
      vault: asAddress(field(details, "vault", 4)),
      ...(field(details, "maturity", 13) ? { maturity: Number(field(details, "maturity", 13)) } : {}),
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

  async execute(action: AppAction, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    return this.app.execute(action, undefined, undefined, options);
  }

  async closureSupport(): Promise<{ retention: boolean; retaining: boolean }> {
    const details = await this.details();
    const bundle = field(details, "bundleId", 20) as `0x${string}`;
    const retention = await this.client.rpc.read<boolean>(this.client.config.core, termbookCoreAbi, "retentionSupported", [bundle]);
    const retaining = await this.client.rpc.read<boolean>(this.client.config.core, termbookCoreAbi, "closingRetention", [this.id]);
    return { retention: retention === true, retaining };
  }

  async reviewRepayment(args: RepayArgs): Promise<{ debt: bigint; cap: bigint; deadline: number }> {
    await this.client.ready();
    if (args.amount !== "max" && args.amount <= 0n || args.maxPayment !== undefined && args.maxPayment <= 0n) throw new Error("param-invalid");
    const deadline = args.deadline ?? Math.floor(Date.now() / 1000) + 900;
    if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1000)) throw new Error("param-invalid");
    const [debt, delayCap] = await this.client.rpc.read<readonly [bigint, bigint]>(this.client.config.core,
      termbookCoreAbi, "repaymentQuote", [this.id, BigInt(deadline)]);
    const cap = args.maxPayment ?? (args.amount === "max" ? delayCap : args.amount);
    if (args.amount === "max" && cap < debt || args.amount !== "max" && cap > args.amount) throw new Error("repayment-cap-invalid");
    return { debt, cap, deadline };
  }

  async repay(args: RepayArgs, options: PaymentOptions = {}): Promise<RepayResult> {
    await this.client.ready();
    if (options.checkpoint) return this.resumeRepayment(options.checkpoint, options);
    const remote = savedPayment(this.client, { kind: "repay", vault: this.client.config.core, creditId: this.id });
    if (remote && remote.stage !== "complete") {
      if (args.from !== "aurora_intents") throw new Error("payment-already-pending");
      return this.resumeRepayment(remote, options);
    }
    const local = options.localCheckpoint ?? savedLocalPayment(this.client, { kind: "repay", chainId: this.client.config.chainId,
      target: this.client.config.core, payer: this.client.signer.address(), creditId: this.id });
    if (local && (options.localCheckpoint || local.stage !== "complete")) return this.resumeLocalRepayment(local, options);
    if (args.amount !== "max" && args.amount <= 0n) throw new Error("param-invalid");
    const details = await this.details();
    const vault = asAddress(field(details, "vault", 4));
    if (!vault) throw new Error("credit-unavailable");
    const asset = await this.client.rpc.read<`0x${string}`>(vault, houseVaultAbi, "asset");
    const review = await this.reviewRepayment(args);
    const { debt, deadline } = review;
    let cap = review.cap;
    if (debt === 0n) return { applied: 0n, remaining: 0n, status: "applied" };
    if (args.from === "aurora_intents") {
      if (!args.source || args.source.maxAmountIn <= 0n) throw new Error("settlement-route-required");
      if (args.source.maxReceived > cap) throw new Error("repayment-cap-invalid");
      const outcome = await remotePayment(this.client, { kind: "repay", payer: this.client.signer.address(),
        vault, token: asset, creditId: this.id, amount: String(cap < debt ? cap : debt), deadline,
        source: { ...args.source, maxAmountIn: String(args.source.maxAmountIn), maxReceived: String(args.source.maxReceived) },
      }, options);
      return { applied: outcome.applied, remaining: outcome.remaining, status: outcome.applied > 0n && outcome.remaining > 0n ? "partial" : outcome.status,
        refunded: outcome.refunded, sourceRefunded: outcome.sourceRefunded, checkpoint: outcome.checkpoint,
        registration: outcome.registration, ...(outcome.registration ?? {}) };
    }

    const fromAccount = args.from === "credit_account";
    if (fromAccount) {
      const cash = await this.client.rpc.creditFreeCash(this.id);
      if (cash < debt && args.amount === "max" || cash === 0n) throw new Error("settle-failed");
      if (cap > cash) cap = cash;
    }
    const result = await localPayment(this.client, { kind: "repay", chainId: this.client.config.chainId,
      payer: this.client.signer.address(), target: this.client.config.core, token: asset, creditId: this.id,
      amount: String(cap), deadline, fromAccount, requireFull: args.amount === "max", stage: "reviewed" }, options);
    const { applied, remaining, tx } = result;
    const repayment: RepayResult = { applied, remaining, status: remaining === 0n ? "applied" : "partial", tx, localCheckpoint: result.checkpoint };
    if (!fromAccount && applied < cap) {
      try {
        repayment.approvalCleanupTx = await this.client.rpc.approve(asset, this.client.config.core, 0n);
        await this.client.rpc.wait(repayment.approvalCleanupTx);
      } catch { repayment.approvalCleanupRequired = true; }
    }
    return repayment;
  }

  async resumeLocalRepayment(checkpoint: LocalPaymentCheckpoint, options: PaymentOptions = {}): Promise<RepayResult> {
    if (checkpoint.kind !== "repay" || checkpoint.creditId?.toLowerCase() !== this.id.toLowerCase()) throw new Error("payment-checkpoint-invalid");
    const result = await localPayment(this.client, checkpoint, { ...options, localCheckpoint: checkpoint });
    return { applied: result.applied, remaining: result.remaining, status: result.remaining === 0n ? "applied" : "partial",
      tx: result.tx, localCheckpoint: result.checkpoint };
  }

  async resumeRepayment(checkpoint: PaymentCheckpoint, options: Omit<PaymentOptions, "checkpoint"> = {}): Promise<RepayResult> {
    if (checkpoint.input.kind !== "repay" || checkpoint.input.creditId?.toLowerCase() !== this.id.toLowerCase()) throw new Error("payment-checkpoint-invalid");
    const outcome = await remotePayment(this.client, checkpoint.input, { ...options, checkpoint });
    return { applied: outcome.applied, remaining: outcome.remaining, status: outcome.applied > 0n && outcome.remaining > 0n ? "partial" : outcome.status,
      refunded: outcome.refunded, sourceRefunded: outcome.sourceRefunded, checkpoint: outcome.checkpoint,
      registration: outcome.registration, ...(outcome.registration ?? {}) };
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
