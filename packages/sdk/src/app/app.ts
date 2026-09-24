import type { TermbookClient } from "../client/client.js";
import type { AppAction, ActionReview } from "../types/app.types.js";
import type { ExecuteResult } from "../types/credit.types.js";
import { requiredDraw } from "../credit/draw.js";
import { encodeAbiParameters, keccak256, parseAbi } from "viem";
import { HttpClient } from "../transport/http.js";
import { buildAction } from "./action.js";
import { CreditAccount } from "../account/account.js";

const coreRegistryAbi = parseAbi(["function integrationRegistry() view returns (address)"]);
const registryAbi = parseAbi(["function validateCall(bytes32,address,bytes,address,uint256) view returns (bool)"]);

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
    const freeAssets = await this.client.rpc.creditAccountTokenBalance(account, asset);
    const amount = requiredDraw(requiredInput, freeAssets);
    const currentDebt = BigInt(String(field("debt", 11)));
    const originationFee = field("originationCharged", 37) ? 0n : BigInt(String(field("originationFee", 31) ?? 0));
    const revisionValue = BigInt(String(field("revision", 17)));
    const nonce = BigInt(String(field("nonce", 18))) + 1n;
    const registry = await this.client.rpc.read<`0x${string}`>(this.client.config.core, coreRegistryAbi, "integrationRegistry");
    if (!/^0x[a-fA-F0-9]{40}$/.test(registry) || /^0x0{40}$/i.test(registry)
      || !await this.client.rpc.read<boolean>(registry, registryAbi, "validateCall", [bundleId, target, data, account, amount])) {
      throw new Error("capability-denied");
    }
    const health = await new CreditAccount(this.client, this.creditId).health();
    const fingerprint = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bytes" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [this.creditId, target, data, amount, currentDebt, revisionValue, nonce, freeAssets, originationFee, health.value ?? 0n],
    ));
    const review: ActionReview = { capability: action.capability, requiredInput, freeAssets, draw: amount,
      currentDebt, projectedDebt: currentDebt + amount + originationFee, originationFee,
      healthBps: health.value, healthState: health.state, settlementAsset: asset, revision: revisionValue, fingerprint };
    return { review, target, data, nonce, definition };
  }

  async review(action: AppAction): Promise<ActionReview> {
    return (await this.prepare(action)).review;
  }

  async execute(action: AppAction, reviewed?: ActionReview): Promise<ExecuteResult> {
    const { review, target, data, nonce, definition } = await this.prepare(action);
    if (reviewed && review.fingerprint !== reviewed.fingerprint) throw new Error("action-review-stale");
    const deadline = Math.floor(Date.now() / 1000) + 900;
    const digest = this.client.signer.actionDigest(
      await this.client.rpc.domain(),
      this.creditId,
      target,
      data,
      review.draw,
      review.draw,
      nonce,
      deadline,
      review.revision,
    );
    const signature = await this.client.signer.signDigest(digest);
    const tx = await this.client.rpc.coreWrite("executeAction", [this.creditId, target, data, review.draw, review.draw, nonce, BigInt(deadline), signature]);
    await this.client.rpc.wait(tx);
    return { status: definition.settlement === "atomic" ? "settled" : "pending", draw: review.draw, tx };
  }

  async capabilities(): Promise<string[]> {
    await this.client.ready();
    return this.client.config.actions?.map((entry) => entry.capability) ?? [];
  }

  private async collection(name: "positions" | "pending"): Promise<unknown[]> {
    await this.client.ready();
    if (!this.client.config.apiBase) throw new Error("application-state-unavailable");
    const data = await new HttpClient(this.client.config.apiBase).get<unknown>(`/credits/${this.creditId}/${name}`);
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>)[name])) return (data as Record<string, unknown>)[name] as unknown[];
    throw new Error("application-state-unavailable");
  }

  async positions(): Promise<unknown[]> {
    return this.collection("positions");
  }

  async pending(): Promise<unknown[]> {
    return this.collection("pending");
  }
}
