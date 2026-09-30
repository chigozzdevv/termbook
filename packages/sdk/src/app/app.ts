import type { TermbookClient } from "../client/client.js";
import type { AppAction, ActionReview, AppPendingAction, AppPosition } from "../types/app.types.js";
import type { ExecuteResult } from "../types/credit.types.js";
import { requiredDraw } from "../credit/draw.js";
import { decodeEventLog, encodeAbiParameters, keccak256, parseAbi, stringToHex } from "viem";
import { HttpClient } from "../transport/http.js";
import { buildAction } from "./action.js";
import { CreditAccount } from "../account/account.js";
import { buildExecution, executionCoreAbi, executionManagerAbi, executionPolicyAbi, type ExecutionAuthorization } from "./execution.js";
import { Signer } from "../wallet/signer.js";
import type { Wallet } from "../types/client.types.js";

const coreRegistryAbi = parseAbi(["function integrationRegistry() view returns (address)"]);
const registryAbi = parseAbi(["function validateCall(bytes32,address,bytes,address,uint256) view returns (bool)"]);
const pendingAbi = parseAbi(["event ActionPending(bytes32 indexed creditId,bytes32 indexed pendingId,bytes32 capability,bytes32 market)"]);
const stateId = /^0x[a-fA-F0-9]{64}$/;

export function slippageBound(refPrice: bigint, bps: number, isMax: boolean): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("param-invalid");
  if (refPrice <= 0n) throw new Error("param-invalid");
  const adj = refPrice * BigInt(bps) / 10_000n;
  return isMax ? refPrice + adj : refPrice - adj;
}

export class CreditApp {
  client: TermbookClient;
  creditId: `0x${string}`;

  constructor(client: TermbookClient, creditId: `0x${string}`) {
    this.client = client;
    this.creditId = creditId;
  }

  private async prepare(action: AppAction) {
    await this.client.ready();
    const definition = this.client.config.actions?.find((entry) => entry.capability === action.capability);
    if (!definition) throw new Error("capability-denied");
    const details = await this.client.rpc.creditDetails(this.creditId);
    const field = (key: string, index: number) => Array.isArray(details) ? details[index] : details[key];
    const account = field("account", 5) as `0x${string}`;
    const vault = field("vault", 4) as `0x${string}`;
    const borrower = field("borrower", 2) as `0x${string}`;
    const bundleId = field("bundleId", 20) as `0x${string}`;
    if (Number(field("facility", 0)) !== 4 || !/^0x[a-fA-F0-9]{40}$/.test(account)
      || !/^0x[a-fA-F0-9]{40}$/.test(vault) || borrower?.toLowerCase() !== this.client.signer.address().toLowerCase()
      || !this.client.config.versionId || bundleId?.toLowerCase() !== this.client.config.versionId.toLowerCase()) {
      throw new Error("credit-action-unavailable");
    }
    const { target, data, requiredInput } = buildAction(definition, action, { borrower, account, creditId: this.creditId });
    const asset = await this.client.rpc.read<`0x${string}`>(vault, [{ type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }] as const, "asset");
    const currentDebt = BigInt(String(field("debt", 11)));
    const originationFee = field("originationCharged", 37) ? 0n : BigInt(String(field("originationFee", 31) ?? 0));
    const revisionValue = BigInt(String(field("revision", 17)));
    const freeAssets = await this.client.rpc.creditFreeCash(this.creditId);
    const amount = requiredDraw(requiredInput, freeAssets);
    const nonce = BigInt(String(field("nonce", 18))) + 1n;
    const managed = await this.client.rpc.read<boolean>(this.client.config.core, executionCoreAbi, "managedBundle", [bundleId]);
    if (!managed && (definition.steps?.length || definition.settlement === "asynchronous")) {
      throw new Error("integration-execution-unavailable");
    }
    const plan = managed ? buildExecution(definition, action, { borrower, account, creditId: this.creditId }, asset) : undefined;
    const registry = await this.client.rpc.read<`0x${string}`>(this.client.config.core, coreRegistryAbi, "integrationRegistry");
    if (!/^0x[a-fA-F0-9]{40}$/.test(registry) || /^0x0{40}$/i.test(registry)) throw new Error("capability-denied");
    for (const call of plan?.calls ?? [{ target, data, spendAmount: requiredInput }]) {
      if (!await this.client.rpc.read<boolean>(registry, registryAbi, "validateCall",
        [bundleId, call.target, call.data, account, call.spendAmount])) throw new Error("capability-denied");
    }
    const health = await new CreditAccount(this.client, this.creditId).health();
    const preview = plan ? await this.client.rpc.previewPlan(this.creditId, plan, amount, nonce)
      : await this.client.rpc.previewAction(this.creditId, target, data, amount, nonce, requiredInput);
    const canExecute = preview.initialBps > 0n && preview.healthBps >= preview.initialBps;
    const fundingFingerprint = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bytes" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [this.creditId, target, data, amount, currentDebt, revisionValue, nonce, freeAssets, originationFee,
        preview.healthBps, preview.initialBps, preview.debt, preview.recoveryValue],
    ));
    const planHash = plan ? keccak256(encodeAbiParameters(executionCoreAbi[2].inputs.slice(1, 2), [plan])) : keccak256(data);
    const fingerprint = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [fundingFingerprint, planHash]));
    const review: ActionReview = { capability: action.capability, requiredInput, freeAssets, draw: amount,
      currentDebt, projectedDebt: preview.debt, originationFee,
      healthBps: health.value, healthState: health.state, projectedHealthBps: preview.healthBps,
      initialHealthBps: preview.initialBps, projectedRecoveryValue: preview.recoveryValue, canExecute,
      settlementAsset: asset, revision: revisionValue, fingerprint };
    return { review, target, data, nonce, definition, plan, bundleId };
  }

  async review(action: AppAction): Promise<ActionReview> {
    return (await this.prepare(action)).review;
  }

  async execute(action: AppAction, reviewed?: ActionReview, sessionWallet?: Wallet): Promise<ExecuteResult> {
    const { review, target, data, nonce, definition, plan, bundleId } = await this.prepare(action);
    if (reviewed && review.fingerprint !== reviewed.fingerprint) throw new Error("action-review-stale");
    if (!review.canExecute) throw new Error("action-health-insufficient");
    const deadline = Math.floor(Date.now() / 1000) + 900;
    if (plan) {
      const signer = sessionWallet ? new Signer(sessionWallet) : this.client.signer;
      const manager = await this.client.rpc.read<`0x${string}`>(this.client.config.core, executionCoreAbi, "executionManager");
      const sessionAbi = parseAbi(["function sessions(bytes32,address) view returns (bytes32 bundleId,bytes32 permissionsHash,uint256 perAction,uint256 total,uint256 spent,uint256 maxExposure,uint256 aggregateExposure,uint256 exposureSpent,uint256 expiry,uint256 generation,uint256 nonce)"]);
      const session = sessionWallet ? await this.client.rpc.read<readonly unknown[]>(manager, sessionAbi, "sessions",
        [this.creditId, signer.address()]) : undefined;
      if (session && String(session[0]).toLowerCase() !== bundleId.toLowerCase()) throw new Error("session-unavailable");
      if (session && (review.requiredInput > BigInt(String(session[2]))
        || review.requiredInput > BigInt(String(session[3])) - BigInt(String(session[4]))
        || plan.exposureLimit > BigInt(String(session[5]))
        || plan.exposureLimit > BigInt(String(session[6])) - BigInt(String(session[7]))
        || BigInt(Math.floor(Date.now() / 1000)) >= BigInt(String(session[8])))) throw new Error("session-unavailable");
      const authorization: ExecutionAuthorization = { drawAmount: review.draw, maxDraw: review.draw,
        nonce: session ? BigInt(String(session[10])) : nonce, deadline: BigInt(deadline), revision: review.revision,
        signer: signer.address(), signature: "0x" };
      const digest = await this.client.rpc.read<`0x${string}`>(this.client.config.core, executionCoreAbi, "executionDigest",
        [this.creditId, plan, authorization]);
      authorization.signature = await signer.signDigest(digest);
      const tx = await this.client.rpc.coreWrite("executePlan", [this.creditId, plan, authorization]);
      const receipt = await this.client.rpc.wait(tx);
      const pendingIds: `0x${string}`[] = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== manager.toLowerCase()) continue;
        try {
          const event = decodeEventLog({ abi: pendingAbi, data: log.data, topics: log.topics });
          if (event.args.creditId.toLowerCase() === this.creditId.toLowerCase()) pendingIds.push(event.args.pendingId);
        } catch { continue; }
      }
      return { status: pendingIds.length === 0 ? "settled" : "pending", pendingIds, draw: review.draw, tx };
    }
    if (sessionWallet) throw new Error("session-unavailable");
    const digest = this.client.signer.fundedActionDigest(
      await this.client.rpc.domain(),
      this.creditId,
      target,
      data,
      review.draw,
      review.requiredInput,
      review.draw,
      nonce,
      deadline,
      review.revision,
    );
    const signature = await this.client.signer.signDigest(digest);
    const tx = await this.client.rpc.coreWrite("executeFundedAction", [this.creditId, target, data,
      review.draw, review.requiredInput, review.draw, nonce, BigInt(deadline), signature]);
    await this.client.rpc.wait(tx);
    return { status: definition.settlement === "atomic" ? "settled" : "pending", draw: review.draw, tx };
  }

  async sync(): Promise<{ tx: `0x${string}` }> {
    await this.client.ready();
    const tx = await this.client.rpc.coreWrite("syncActions", [this.creditId]);
    await this.client.rpc.wait(tx);
    return { tx };
  }

  async syncIfChanged(currentDetails?: Record<string, unknown>): Promise<{ tx: `0x${string}` } | undefined> {
    await this.client.ready();
    const details = currentDetails ?? await this.client.rpc.creditDetails(this.creditId);
    const bundle = (Array.isArray(details) ? details[20] : details["bundleId"]) as `0x${string}`;
    const account = (Array.isArray(details) ? details[5] : details["account"]) as `0x${string}`;
    if (!await this.client.rpc.read<boolean>(this.client.config.core, executionCoreAbi, "managedBundle", [bundle])) return;
    const manager = await this.client.rpc.read<`0x${string}`>(this.client.config.core, executionCoreAbi, "executionManager");
    const count = await this.client.rpc.read<bigint>(manager, executionManagerAbi, "pendingCount", [this.creditId]);
    if (count > 32n) throw new Error("application-state-unavailable");
    if (count === 0n) return;
    const config = await this.client.rpc.read<readonly unknown[]>(manager, executionManagerAbi, "bundles", [bundle]);
    for (let index = 0n; index < count; ++index) {
      const id = await this.client.rpc.read<`0x${string}`>(manager, executionManagerAbi, "pendingAt", [this.creditId, index]);
      const [record, current] = await Promise.all([
        this.client.rpc.read<readonly [unknown, unknown, unknown, unknown, Record<string, unknown>]>(manager,
          executionManagerAbi, "records", [this.creditId, id]),
        this.client.rpc.read<Record<string, unknown>>(config[0] as `0x${string}`, executionPolicyAbi,
          "pendingState", [this.creditId, account, id]),
      ]);
      if (Object.keys(record[4]).some((key) => key !== "observedAt"
        && String(record[4][key]).toLowerCase() !== String(current[key]).toLowerCase())) return this.sync();
    }
    return;
  }

  async authorizeSession(key: `0x${string}`, scope: { permissions: { capability: string; market: `0x${string}` }[];
    perAction: bigint; total: bigint; maxExposure: bigint; aggregateExposure: bigint; expiry: number }): Promise<{ tx: `0x${string}` }> {
    await this.client.ready();
    if (!/^0x[a-fA-F0-9]{40}$/.test(key) || scope.permissions.length === 0 || scope.permissions.length > 16
      || /^0x0{40}$/i.test(key) || scope.perAction <= 0n || scope.total < scope.perAction
      || scope.maxExposure <= 0n || scope.aggregateExposure < scope.maxExposure
      || [scope.total, scope.aggregateExposure].some((value) => value >= 2n ** 256n)
      || !Number.isSafeInteger(scope.expiry) || scope.expiry <= Math.floor(Date.now() / 1000)) throw new Error("param-invalid");
    const permissions = scope.permissions.map((permission) => {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(permission.capability) || !/^0x[a-fA-F0-9]{64}$/.test(permission.market)) throw new Error("param-invalid");
      return { capability: keccak256(stringToHex(permission.capability)), market: permission.market };
    });
    const tx = await this.client.rpc.coreWrite("configureExecutionSession", [this.creditId, key, permissions,
      scope.perAction, scope.total, scope.maxExposure, scope.aggregateExposure, BigInt(scope.expiry)]);
    await this.client.rpc.wait(tx);
    return { tx };
  }

  async revokeSession(key: `0x${string}`): Promise<{ tx: `0x${string}` }> {
    await this.client.ready();
    if (!/^0x[a-fA-F0-9]{40}$/.test(key)) throw new Error("param-invalid");
    const tx = await this.client.rpc.coreWrite("revokeExecutionSession", [this.creditId, key]);
    await this.client.rpc.wait(tx);
    return { tx };
  }

  async capabilities(): Promise<string[]> {
    await this.client.ready();
    return this.client.config.actions?.map((entry) => entry.capability) ?? [];
  }

  async exit(instruction: `0x${string}`): Promise<{ tx: `0x${string}` }> {
    if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(instruction)) throw new Error("param-invalid");
    await this.client.ready();
    const tx = await this.client.rpc.coreWrite("exitApp", [this.creditId, instruction]);
    await this.client.rpc.wait(tx);
    return { tx };
  }

  private async collection(name: "positions" | "pending"): Promise<unknown[]> {
    await this.client.ready();
    if (!this.client.config.apiBase) throw new Error("application-state-unavailable");
    let data: unknown;
    try {
      data = await new HttpClient(this.client.config.apiBase).get<unknown>(`/credits/${this.creditId}/${name}`);
    } catch (error) {
      if (error instanceof Error && error.message === "http-503") throw new Error("application-state-unavailable", { cause: error });
      throw error;
    }
    if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>)[name])) return (data as Record<string, unknown>)[name] as unknown[];
    throw new Error("application-state-unavailable");
  }

  async positions(): Promise<AppPosition[]> {
    const rows = await this.collection("positions");
    return rows.map((row) => {
      if (!row || typeof row !== "object") throw new Error("application-state-unavailable");
      const entry = row as Record<string, unknown>;
      if (typeof entry["positionId"] !== "string" || !stateId.test(entry["positionId"])
        || typeof entry["marketId"] !== "string" || !stateId.test(entry["marketId"])) {
        throw new Error("application-state-unavailable");
      }
      return { positionId: entry["positionId"] as `0x${string}`, marketId: entry["marketId"] as `0x${string}` };
    });
  }

  async pending(): Promise<AppPendingAction[]> {
    const rows = await this.collection("pending");
    return rows.map((row) => {
      if (!row || typeof row !== "object") throw new Error("application-state-unavailable");
      const entry = row as Record<string, unknown>;
      if (typeof entry["actionId"] !== "string" || !stateId.test(entry["actionId"])
        || typeof entry["positionId"] !== "string" || !stateId.test(entry["positionId"])
        || typeof entry["remainingLiability"] !== "string" || !/^\d+$/.test(entry["remainingLiability"])
        || typeof entry["deadline"] !== "string" || !/^[1-9]\d*$/.test(entry["deadline"])) {
        throw new Error("application-state-unavailable");
      }
      return { actionId: entry["actionId"] as `0x${string}`, positionId: entry["positionId"] as `0x${string}`,
        remainingLiability: BigInt(entry["remainingLiability"]), deadline: BigInt(entry["deadline"]) };
    });
  }
}
