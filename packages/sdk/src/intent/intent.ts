import type { TermbookClient } from "../client/client.js";
import type { IntentRequest } from "../types/intent.types.js";
import { Credit } from "../credit/credit.js";
import { HttpClient } from "../transport/http.js";
import { encodeAbiParameters, keccak256 } from "viem";
import { accountFactoryAbi } from "@termbook/bindings";

export type Offer = {
  id: string;
  intentId: `0x${string}`;
  borrower: `0x${string}`;
  owner?: `0x${string}`;
  house: `0x${string}`;
  vault: `0x${string}`;
  sourceChain?: number;
  collateralVault?: `0x${string}`;
  collateralAsset?: `0x${string}`;
  collateralAmount?: bigint;
  returnRecipient?: `0x${string}`;
  settlementAsset?: `0x${string}`;
  limit: bigint;
  aprBps: number;
  originationFee: bigint;
  commitmentFeeBps: number;
  expiry: number;
  maturity: number;
  setupDeadline: number;
  grace: number;
  reservationBond: bigint;
  nonce: bigint;
  bundleId: `0x${string}`;
  termsHash: `0x${string}`;
  signature: `0x${string}`;
  revolving: boolean;
};

function address(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("offer-invalid");
  return value as `0x${string}`;
}

function bytes32(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error("offer-invalid");
  return value as `0x${string}`;
}

function parseOffer(raw: Record<string, unknown>): Offer {
  const expiry = Number(raw["expiry"]);
  const maturity = Number(raw["maturity"]);
  const setupDeadline = Number(raw["setupDeadline"] ?? raw["setup_deadline"]);
  const grace = Number(raw["grace"] ?? raw["gracePeriod"] ?? raw["grace_period"] ?? 0);
  if (![expiry, maturity, setupDeadline, grace].every(Number.isSafeInteger) || expiry * 1000 <= Date.now() || setupDeadline < expiry || maturity <= setupDeadline) throw new Error("offer-expired");
  const limit = BigInt(String(raw["limit"]));
  const collateralAmount = raw["collateralAmount"] ?? raw["collateral_amount"];
  const reservationBond = BigInt(String(raw["reservationBond"] ?? raw["reservation_bond"] ?? "0"));
  const originationFee = BigInt(String(raw["originationFee"] ?? raw["origination_fee"] ?? "0"));
  const commitmentFeeBps = Number(raw["commitmentFeeBps"] ?? raw["commitment_fee_bps"] ?? 0);
  const aprBps = Number(raw["aprBps"] ?? raw["apr_bps"] ?? 0);
  const nonce = BigInt(String(raw["nonce"] ?? "0"));
  if (limit <= 0n || nonce < 0n || reservationBond < 0n || originationFee < 0n || !Number.isSafeInteger(aprBps) || aprBps < 0 || aprBps > 1_000_000 || !Number.isSafeInteger(commitmentFeeBps) || commitmentFeeBps < 0 || commitmentFeeBps > 10_000) throw new Error("offer-invalid");
  const signature = raw["signature"];
  if (typeof signature !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new Error("offer-invalid");
  const id = String(raw["id"] ?? raw["quoteId"] ?? "");
  if (!id) throw new Error("offer-invalid");
  return {
    id,
    intentId: bytes32(raw["intentId"] ?? raw["intent_id"]),
    borrower: address(raw["borrower"]),
    owner: raw["owner"] === undefined ? undefined : address(raw["owner"]),
    house: address(raw["house"]),
    vault: address(raw["vault"]),
    sourceChain: raw["sourceChain"] === undefined ? undefined : Number(raw["sourceChain"]),
    collateralVault: raw["collateralVault"] === undefined ? undefined : address(raw["collateralVault"]),
    collateralAsset: raw["collateralAsset"] === undefined ? undefined : address(raw["collateralAsset"]),
    collateralAmount: collateralAmount === undefined ? undefined : BigInt(String(collateralAmount)),
    returnRecipient: raw["returnRecipient"] === undefined ? undefined : address(raw["returnRecipient"]),
    settlementAsset: raw["settlementAsset"] === undefined ? undefined : address(raw["settlementAsset"]),
    limit,
    aprBps,
    originationFee,
    commitmentFeeBps,
    expiry,
    maturity,
    setupDeadline,
    grace,
    reservationBond,
    nonce,
    bundleId: bytes32(raw["bundleId"] ?? raw["bundle_id"]),
    termsHash: bytes32(raw["termsHash"] ?? raw["terms_hash"]),
    signature: signature as `0x${string}`,
    revolving: Boolean(raw["revolving"] ?? false),
  };
}

export class Intent {
  client: TermbookClient;
  request?: IntentRequest;
  private intentId: `0x${string}` | null = null;

  constructor(client: TermbookClient, request?: IntentRequest) {
    if (request) {
      if (!request.credit.duration || request.credit.duration <= 0) throw new Error("param-invalid");
      if (request.credit.limit !== undefined && request.credit.limit <= 0n) throw new Error("param-invalid");
      if (request.collateral.amount <= 0n || request.collateral.chainId <= 0) throw new Error("param-invalid");
    }
    this.client = client;
    this.request = request;
  }

  private requiredRequest(): IntentRequest {
    if (!this.request) throw new Error("request-required");
    return this.request;
  }

  async submit(): Promise<`0x${string}`> {
    if (this.intentId) return this.intentId;
    const request = this.requiredRequest();
    const base = this.client.config.apiBase;
    if (!base) throw new Error("api-required");
    const response = await this.client.authenticatedPost<{ intentId?: string; intent_id?: string }>("/intents", {
      borrower: this.client.signer.address(),
      chainId: request.collateral.chainId,
      asset: request.collateral.asset,
      amount: request.collateral.amount.toString(),
      owner: request.collateral.owner,
      recipient: request.collateral.recipient,
      duration: request.credit.duration,
      action: request.action,
      limit: request.credit.limit?.toString(),
    });
    const id = response.intentId ?? response.intent_id;
    if (!id || !/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("intent-invalid");
    this.intentId = id as `0x${string}`;
    return this.intentId;
  }

  async offers(): Promise<Offer[]> {
    const intentId = await this.submit();
    const base = this.client.config.apiBase;
    if (!base) throw new Error("api-required");
    const rows = await new HttpClient(base).get<Record<string, unknown>[]>(`/quotes?intentId=${intentId}`);
    return rows
      .map(parseOffer)
      .filter((offer) => offer.intentId === intentId && offer.borrower.toLowerCase() === this.client.signer.address().toLowerCase())
      .slice(0, 5);
  }

  async accept(args: { offer_id?: string; offerId?: string }): Promise<Credit> {
    const request = this.requiredRequest();
    const offerId = args.offer_id ?? args.offerId;
    if (!offerId) throw new Error("offer-required");
    const offer = (await this.offers()).find((item) => item.id === offerId);
    if (!offer) throw new Error("offer-not-found");
    if (offer.borrower.toLowerCase() !== this.client.signer.address().toLowerCase()) throw new Error("unauthorized");
    const creditId = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
        [offer.intentId, offer.borrower, offer.house, offer.nonce],
      ),
    );
    const vaultAsset = await this.client.rpc.read<`0x${string}`>(offer.vault, [
      { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
    ] as const, "asset");
    if (offer.reservationBond > 0n) {
      const bondApproval = await this.client.rpc.approve(vaultAsset, offer.vault, offer.reservationBond);
      await this.client.rpc.wait(bondApproval);
    }
    const completeQuote = offer.owner !== undefined && offer.sourceChain !== undefined && offer.collateralVault !== undefined && offer.collateralAsset !== undefined && offer.collateralAmount !== undefined && offer.returnRecipient !== undefined && offer.settlementAsset !== undefined;
    const requestedOwner = request.collateral.owner ?? this.client.signer.address();
    const requestedRecipient = request.collateral.recipient ?? this.client.signer.address();
    if (completeQuote) {
      if (offer.owner!.toLowerCase() !== requestedOwner.toLowerCase() || offer.sourceChain !== request.collateral.chainId || offer.collateralAsset!.toLowerCase() !== request.collateral.asset.toLowerCase() || offer.collateralAmount !== request.collateral.amount || offer.returnRecipient!.toLowerCase() !== requestedRecipient.toLowerCase()) throw new Error("offer-collateral-mismatch");
      if (!this.client.config.collateralVault || offer.collateralVault!.toLowerCase() !== this.client.config.collateralVault.toLowerCase()) throw new Error("collateral-config-required");
    }
    const acceptTx = completeQuote
      ? await this.client.rpc.coreWrite("acceptQuote", [{
          borrower: offer.borrower,
          owner: offer.owner,
          intentId: offer.intentId,
          house: offer.house,
          vault: offer.vault,
          sourceChain: BigInt(offer.sourceChain!),
          collateralVault: offer.collateralVault,
          collateralAsset: offer.collateralAsset,
          collateralAmount: offer.collateralAmount,
          returnRecipient: offer.returnRecipient,
          settlementAsset: offer.settlementAsset,
          limit: offer.limit,
          bundleId: offer.bundleId,
          setupDeadline: BigInt(offer.setupDeadline),
          maturity: BigInt(offer.maturity),
          gracePeriod: BigInt(offer.grace),
          reservationBond: offer.reservationBond,
          nonce: offer.nonce,
          expiry: BigInt(offer.expiry),
          termsHash: offer.termsHash,
          aprBps: BigInt(offer.aprBps),
          originationFee: offer.originationFee,
          commitmentFeeBps: BigInt(offer.commitmentFeeBps),
          revolving: offer.revolving,
          signature: offer.signature,
        }])
      : offer.aprBps !== 0 || offer.originationFee !== 0n || offer.commitmentFeeBps !== 0
      ? await this.client.rpc.coreWrite("acceptWithTerms", [
          creditId,
          offer.intentId,
          offer.borrower,
          offer.house,
          offer.vault,
          offer.limit,
          BigInt(offer.maturity),
          offer.revolving,
          offer.bundleId,
          BigInt(offer.setupDeadline),
          BigInt(offer.grace),
          offer.reservationBond,
          offer.termsHash,
          offer.nonce,
          BigInt(offer.expiry),
          BigInt(offer.aprBps),
          offer.originationFee,
          BigInt(offer.commitmentFeeBps),
          offer.signature,
        ])
      : await this.client.rpc.coreWrite("acceptWithBond", [
          creditId,
          offer.intentId,
          offer.borrower,
          offer.house,
          offer.vault,
          offer.limit,
          BigInt(offer.maturity),
          offer.revolving,
          offer.bundleId,
          BigInt(offer.setupDeadline),
          BigInt(offer.grace),
          offer.reservationBond,
          offer.termsHash,
          offer.nonce,
          BigInt(offer.expiry),
          offer.signature,
        ]);
    await this.client.rpc.wait(acceptTx);
    const credit = new Credit(this.client, creditId);
    if (!this.client.config.collateralVault || !this.client.config.accountFactory) throw new Error("setup-config-required");
    await credit.collateral.add({
      amount: request.collateral.amount,
      asset: request.collateral.asset,
      owner: request.collateral.owner ?? this.client.signer.address(),
      recipient: request.collateral.recipient ?? this.client.signer.address(),
      sourceChain: request.collateral.chainId,
      deadline: offer.setupDeadline,
    });
    const createTx = await this.client.rpc.write(this.client.config.accountFactory, accountFactoryAbi, "create", [creditId, this.client.signer.address(), this.client.config.core]);
    await this.client.rpc.wait(createTx);
    const account = await this.client.rpc.read<`0x${string}`>(this.client.config.accountFactory, accountFactoryAbi, "accountOf", [creditId]);
    if (!/^0x[a-fA-F0-9]{40}$/.test(account)) throw new Error("account-create-failed");
    const bindTx = await this.client.rpc.coreWrite("bindAccount", [creditId, account]);
    await this.client.rpc.wait(bindTx);
    return credit;
  }
}
