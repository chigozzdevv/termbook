import type { TermbookClient } from "../client/client.js";
import type { AppAction, ActionReview, AppPendingAction, AppPosition } from "../types/app.types.js";
import type { ExecuteResult, ExecuteOptions } from "../types/credit.types.js";
import { completeExecution, savedExecution } from "./completion.js";
import { requiredDraw } from "../credit/draw.js";
import { encodeAbiParameters, keccak256, parseAbi, stringToHex } from "viem";
import { HttpClient } from "../transport/http.js";
import { buildAction } from "./action.js";
import { CreditAccount } from "../account/account.js";
import { buildExecution, emptyExecutionPrice, priceTuple, executionCoreAbi, executionManagerAbi, executionPolicyAbi, type ExecutionAuthorization, type ExecutionPrice } from "./execution.js";
import { executionPrice } from "./price.js";
import { Signer } from "../wallet/signer.js";
import type { Wallet } from "../types/client.types.js";
import { assertActionUseCase, assertStandardAction, executionKey, selectCapability, type TermAction } from "@termbook/schema";
import { readActionState } from "./state.js";
import { verify_definition } from "../integration/pins.js";

const coreRegistryAbi = parseAbi(["function integrationRegistry() view returns (address)"]);
const registryAbi = parseAbi(["function validateCall(bytes32,address,bytes,address,uint256) view returns (bool)",
  "function validateValueCall(bytes32,address,bytes,address,uint256,uint256) view returns (bool)"]);
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

  private async prepare(action: TermAction, previousPrice?: ExecutionPrice) {
    await this.client.ready();
    if (this.client.config.chainId !== 10143 && this.client.config.integration_definition)
      await verify_definition(this.client.rpc.client, this.client.config.integration_definition);
    assertActionUseCase(action, this.client.config.use_case);
    assertStandardAction(action, this.client.config.use_case);
    if (this.client.config.use_case) action = { ...action, use_case: this.client.config.use_case };
    const definition = selectCapability(this.client.config.actions ?? [], action);
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
    const state = await readActionState(this.client, definition, action, { borrower, account, creditId: this.creditId });
    const price = await executionPrice(this.client, this.creditId, bundleId, definition, action, previousPrice, state);
    const context = { borrower, account, creditId: this.creditId, use_case: this.client.config.use_case, state, ...(price ? { priceBound: price.bound } : {}) };
    const { target, data, requiredInput: fundingInput } = buildAction(definition, action, context);
    const asset = await this.client.rpc.read<`0x${string}`>(vault, [{ type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }] as const, "asset");
    const currentDebt = BigInt(String(field("debt", 11)));
    const originationFee = field("originationCharged", 37) ? 0n : BigInt(String(field("originationFee", 31) ?? 0));
    const revisionValue = BigInt(String(field("revision", 17)));
    const freeAssets = await this.client.rpc.creditFreeCash(this.creditId);
    const nonce = BigInt(String(field("nonce", 18))) + 1n;
    const managed = await this.client.rpc.read<boolean>(this.client.config.core, executionCoreAbi, "managedBundle", [bundleId]);
    if (!managed && (definition.steps?.length || definition.settlement === "asynchronous"
      || definition.spendPath || definition.spendAmount !== undefined || definition.fundingAmount !== undefined || definition.nativeValue !== undefined
      || definition.valuePath || definition.valueFromBound || definition.spendFromBound || definition.fundingFromBound || definition.price)) {
      throw new Error("integration-execution-unavailable");
    }
    const plan = managed ? buildExecution(definition, action, context, asset) : undefined;
    const requiredInput = plan?.requiredInput ?? fundingInput;
    const amount = requiredDraw(requiredInput, freeAssets);
    if (amount > fundingInput) throw new Error("action-owned-cash-insufficient");
    if (plan) {
      const version = await this.client.rpc.read<bigint>(this.client.config.core, executionCoreAbi, "executionVersion").catch(() => 0n);
      if (version !== 2n) throw new Error("integration-execution-version-unsupported");
    }
    const registry = await this.client.rpc.read<`0x${string}`>(this.client.config.core, coreRegistryAbi, "integrationRegistry");
    if (!/^0x[a-fA-F0-9]{40}$/.test(registry) || /^0x0{40}$/i.test(registry)) throw new Error("capability-denied");
    for (const call of plan?.calls ?? [{ target, data, spendAmount: requiredInput, nativeValue: 0n }]) {
      const allowed = !plan
        ? await this.client.rpc.read<boolean>(registry, registryAbi, "validateCall", [bundleId, call.target, call.data, account, call.spendAmount])
        : await this.client.rpc.read<boolean>(registry, registryAbi, "validateValueCall", [bundleId, call.target, call.data, account, call.spendAmount, call.nativeValue]);
      if (!allowed) throw new Error("capability-denied");
    }
    const health = await new CreditAccount(this.client, this.creditId).health();
    const preview = plan ? await this.client.rpc.previewPlan(this.creditId, plan, amount, nonce, price ?? emptyExecutionPrice)
      : await this.client.rpc.previewAction(this.creditId, target, data, amount, nonce, requiredInput);
    const canExecute = preview.initialBps > 0n && preview.healthBps >= preview.initialBps;
    const fundingFingerprint = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bytes" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
      ],
      [this.creditId, target, data, amount, currentDebt, revisionValue, nonce, freeAssets, originationFee,
        preview.initialBps],
    ));
    const planHash = plan ? keccak256(encodeAbiParameters(executionCoreAbi[2].inputs.slice(1, 2), [plan])) : keccak256(data);
    const priceHash = keccak256(encodeAbiParameters(parseAbi([`function quote(${priceTuple})`])[0].inputs, [price ?? emptyExecutionPrice]));
    const fingerprint = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [fundingFingerprint, planHash, priceHash]));
    const review: ActionReview = { capability: action.capability, requiredInput, freeAssets, draw: amount,
      currentDebt, projectedDebt: preview.debt, originationFee,
      healthBps: health.value, healthState: health.state, projectedHealthBps: preview.healthBps,
      initialHealthBps: preview.initialBps, projectedRecoveryValue: preview.recoveryValue, canExecute,
      settlementAsset: asset, revision: revisionValue, fingerprint, ...(price ? { price } : {}) };
    if (plan) {
      review.nativeValue = plan.calls.reduce((total, call) => total + call.nativeValue, 0n);
      review.spending = plan.calls.filter((call) => call.spendAmount > 0n).map((call) => ({ token: call.spendToken, amount: call.spendAmount }));
    }
    if (price) review.boundKind = definition.price?.kind ?? "price";
    return { review, target, data, nonce, definition, plan, bundleId };
  }

  async review(action: AppAction): Promise<ActionReview> {
    return (await this.prepare(action)).review;
  }

  async execute(action: AppAction, reviewed?: ActionReview, sessionWallet?: Wallet, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    if (options.checkpoint) {
      if (options.checkpoint.capability !== action.capability) throw new Error("action-checkpoint-invalid");
      return this.resumeExecution(options);
    }
    const { review, target, data, nonce, definition, plan, bundleId } = await this.prepare(action, reviewed?.price);
    if (!review.canExecute) throw new Error("action-health-insufficient");
    if (reviewed && review.fingerprint !== reviewed.fingerprint) throw new Error("action-review-stale");
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
        signer: signer.address(), signature: "0x", price: review.price ?? emptyExecutionPrice };
      const digest = await this.client.rpc.read<`0x${string}`>(this.client.config.core, executionCoreAbi, "executionDigest",
        [this.creditId, plan, authorization]);
      authorization.signature = await signer.signDigest(digest);
      const tx = await this.client.rpc.coreWrite("executePlan", [this.creditId, plan, authorization]);
      return this.resumeExecution({ ...options, checkpoint: { chainId: this.client.config.chainId, core: this.client.config.core,
        creditId: this.creditId, tx, capability: action.capability, executionKey: executionKey(definition), stage: "submitted" } });
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

  async resumeExecution(options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const checkpoint = options.checkpoint ?? savedExecution(this.client, this.creditId);
    if (!checkpoint) throw new Error("action-checkpoint-unavailable");
    return completeExecution(this.client, this.creditId, checkpoint, options, () => this.syncIfChanged());
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
    const permissions = scope.permissions.flatMap((permission) => {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(permission.capability) || !/^0x[a-fA-F0-9]{64}$/.test(permission.market)) throw new Error("param-invalid");
      const routes = this.client.config.actions?.filter((action) => action.capability === permission.capability
        && (!action.price || action.price.markets.some((market) => market.toLowerCase() === permission.market.toLowerCase()))) ?? [];
      if (!routes.length) throw new Error("capability-denied");
      return routes.map((route) => ({ capability: keccak256(stringToHex(executionKey(route))), market: permission.market }));
    });
    if (permissions.length > 16 || new Set(permissions.map((permission) => `${permission.capability}:${permission.market}`)).size !== permissions.length) throw new Error("param-invalid");
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
    return [...new Set(this.client.config.actions?.map((entry) => entry.capability) ?? [])];
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
