import type { TermbookClient } from "../client/client.js";
import type { AppAction } from "../types/app.types.js";
import type { ExecuteResult } from "../types/credit.types.js";
import { requiredDraw } from "../credit/draw.js";
import { appGatewayAbi } from "@termbook/bindings";
import { keccak256, toBytes } from "viem";
import { HttpClient } from "../transport/http.js";

const allowed: ReadonlySet<string> = new Set([
  "place_order", "increase_position", "decrease_position", "add_margin", "remove_margin",
  "cancel_order", "close_position", "stake", "unstake", "claim_rewards", "deposit", "withdraw",
  "swap", "supply", "borrow", "repay", "flash_loan",
]);

export function slippageBound(refPrice: bigint, bps: number, isMax: boolean): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("param-invalid");
  if (refPrice <= 0n) throw new Error("param-invalid");
  const adj = refPrice * BigInt(bps) / 10_000n;
  return isMax ? refPrice + adj : refPrice - adj;
}

function bigintParam(value: unknown, fallback = 0n): bigint {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error("param-invalid");
}

export class CreditApp {
  client: TermbookClient;
  creditId: `0x${string}`;

  constructor(client: TermbookClient, creditId: `0x${string}`) {
    this.client = client;
    this.creditId = creditId;
  }

  async execute(action: AppAction): Promise<ExecuteResult> {
    if (!allowed.has(action.capability)) throw new Error("capability-denied");
    let target = action.target;
    let data = action.data;
    if (!target || !data) {
      const gateway = this.client.config.appGateway;
      const encodedParams = action.params["encoded_params"] ?? action.params["encodedParams"];
      if (!gateway || typeof encodedParams !== "string" || !/^0x[0-9a-fA-F]*$/.test(encodedParams)) throw new Error("action-routing-required");
      const built = await this.client.rpc.read<readonly unknown[]>(gateway, appGatewayAbi, "buildCall", [keccak256(toBytes(action.capability)), encodedParams]);
      target = built[0] as `0x${string}`;
      data = built[1] as `0x${string}`;
    }
    if (!target || !/^0x[a-fA-F0-9]{40}$/.test(target)) throw new Error("action-target-required");
    if (!data || !/^0x[a-fA-F0-9]*$/.test(data) || data.length < 10) throw new Error("action-data-required");
    const params = action.params;
    const slippage = params["slippage_bps"];
    if (slippage !== undefined) {
      if (typeof slippage !== "number" || !Number.isInteger(slippage) || slippage < 0 || slippage > 10_000) throw new Error("param-invalid");
      if (params["reference_price"] !== undefined) {
        const isMax = params["is_max"] === true;
        slippageBound(bigintParam(params["reference_price"]), slippage, isMax);
      }
    }
    const details = await this.client.rpc.creditDetails(this.creditId);
    const account = (Array.isArray(details) ? details[5] : details["account"]) as `0x${string}`;
    const vault = (Array.isArray(details) ? details[4] : details["vault"]) as `0x${string}`;
    const asset = await this.client.rpc.read<`0x${string}`>(vault, [{ type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }] as const, "asset");
    const freeAssets = await this.client.rpc.creditAccountTokenBalance(account, asset);
    const requiredInput = bigintParam(params["required_input"] ?? params["requiredInput"]);
    const amount = requiredDraw(requiredInput, freeAssets);
    const maxBound = bigintParam(params["max_draw"] ?? params["maxDraw"], amount);
    if (maxBound < amount) throw new Error("draw-capped");
    const creditNonce = bigintParam(Array.isArray(details) ? details[18] : details["nonce"]);
    const nonce = bigintParam(params["nonce"], creditNonce + 1n);
    const deadline = Number(params["deadline"] ?? Math.floor(Date.now() / 1000) + 900);
    if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1000)) throw new Error("expired");
    const revisionValue = await this.client.rpc.revision(this.creditId);
    const digest = this.client.signer.actionDigest(
      await this.client.rpc.domain(),
      this.creditId,
      target,
      data,
      amount,
      maxBound,
      nonce,
      deadline,
      revisionValue,
    );
    const signature = await this.client.signer.signDigest(digest);
    const tx = await this.client.rpc.coreWrite("executeAction", [this.creditId, target, data, amount, maxBound, nonce, BigInt(deadline), signature]);
    await this.client.rpc.wait(tx);
    return { status: "settled", draw: amount, tx };
  }

  async capabilities(): Promise<string[]> {
    return [...allowed];
  }

  private async collection(name: "positions" | "pending"): Promise<unknown[]> {
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
