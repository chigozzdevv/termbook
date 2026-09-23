import type { TermbookClient } from "../client/client.js";
import type { EvmCollateralSelection, IntentRequest } from "../types/intent.types.js";
import { Credit } from "../credit/credit.js";
import { HttpClient } from "../transport/http.js";
import { encodeAbiParameters, keccak256 } from "viem";
import { collateralSelectionSchema, type CollateralSetupBinding, type CollateralSetupCheckpoint } from "@termbook/schema";
import { CollateralChainNotIntegratedError, CollateralSetup, CollateralSetupInterruptedError, type CollateralProofSource } from "../collateral/setup.js";
import { EvmSourceLockWallet, type EvmSourceWalletConfig } from "../collateral/evm-source.js";

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

export type AcceptOptions = {
  offer_id?: string;
  offerId?: string;
  source_wallet?: EvmSourceWalletConfig;
  proof_source?: CollateralProofSource;
  checkpoint?: CollateralSetupCheckpoint;
  on_progress?: (checkpoint: CollateralSetupCheckpoint, binding: CollateralSetupBinding) => void | Promise<void>;
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
      if ("chain" in request.collateral) collateralSelectionSchema.parse(request.collateral);
      else if (request.collateral.amount <= 0n || request.collateral.chainId <= 0) throw new Error("param-invalid");
    }
    this.client = client;
    this.request = request;
  }

  private requiredRequest(): IntentRequest {
    if (!this.request) throw new Error("request-required");
    return this.request;
  }

  private evmCollateral(): EvmCollateralSelection {
    const selection = this.requiredRequest().collateral;
    if (!("chain" in selection)) return selection;
    if (selection.chain.namespace !== "eip155" || selection.asset.namespace !== "eip155" || selection.owner.namespace !== "eip155" || selection.returnRecipient.namespace !== "eip155") throw new CollateralChainNotIntegratedError(selection.chain.namespace);
    const chainId = Number(selection.chain.reference);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("source-chain-invalid");
    return { chainId, asset: selection.asset.assetBytes, amount: selection.amount, owner: selection.owner.accountBytes, recipient: selection.returnRecipient.accountBytes };
  }

  async submit(): Promise<`0x${string}`> {
    if (this.intentId) return this.intentId;
    const request = this.requiredRequest();
    const collateral = this.evmCollateral();
    const base = this.client.config.apiBase;
    if (!base) throw new Error("api-required");
    const response = await this.client.authenticatedPost<{ intentId?: string; intent_id?: string }>("/intents", {
      borrower: this.client.signer.address(),
      chainId: collateral.chainId,
      asset: collateral.asset,
      amount: collateral.amount.toString(),
      owner: collateral.owner,
      recipient: collateral.recipient,
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

  async accept(args: AcceptOptions): Promise<Credit> {
    const collateral = this.evmCollateral();
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
    const completeQuote = offer.owner !== undefined && offer.sourceChain !== undefined && offer.collateralVault !== undefined && offer.collateralAsset !== undefined && offer.collateralAmount !== undefined && offer.returnRecipient !== undefined && offer.settlementAsset !== undefined;
    if (!completeQuote) throw new Error("offer-collateral-unbound");
    const requestedOwner = collateral.owner ?? this.client.signer.address();
    const requestedRecipient = collateral.recipient ?? requestedOwner;
    if (offer.owner!.toLowerCase() !== requestedOwner.toLowerCase() || offer.sourceChain !== collateral.chainId || offer.collateralAsset!.toLowerCase() !== collateral.asset.toLowerCase() || offer.collateralAmount !== collateral.amount || offer.returnRecipient!.toLowerCase() !== requestedRecipient.toLowerCase()) throw new Error("offer-collateral-mismatch");
    const sourceWallet = args.source_wallet
      ? new EvmSourceLockWallet(args.source_wallet)
      : collateral.chainId === this.client.config.chainId && requestedOwner.toLowerCase() === this.client.signer.address().toLowerCase() && this.client.config.rpcUrl
        ? new EvmSourceLockWallet({
            chainId: this.client.config.chainId,
            rpcUrl: this.client.config.rpcUrl,
            wallet: this.client.config.wallet,
            vault: offer.collateralVault!,
            asset: offer.collateralAsset!,
            controller: this.client.config.core,
          })
        : undefined;
    if (!sourceWallet) throw new Error("source-wallet-required");
    const source = { namespace: "eip155" as const, reference: String(collateral.chainId) };
    const binding: CollateralSetupBinding = {
      version: 1,
      monadChainId: this.client.config.chainId,
      core: this.client.config.core,
      creditId,
      intentId: offer.intentId,
      termsHash: offer.termsHash,
      borrower: offer.borrower,
      house: offer.house,
      sourceVault: { ...source, accountBytes: offer.collateralVault! },
      asset: { ...source, kind: "erc20", assetBytes: offer.collateralAsset! },
      amount: offer.collateralAmount!,
      owner: { ...source, accountBytes: offer.owner! },
      returnRecipient: { ...source, accountBytes: offer.returnRecipient! },
      setupDeadline: offer.setupDeadline,
      nonce: offer.nonce,
    };
    const setup = new CollateralSetup(this.client, binding, {
      sourceWallet,
      proofSource: args.proof_source,
      checkpoint: args.checkpoint,
      onProgress: args.on_progress,
      reserve: async () => {
        const vaultAsset = await this.client.rpc.read<`0x${string}`>(offer.vault, [
          { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
        ] as const, "asset");
        if (vaultAsset.toLowerCase() !== offer.settlementAsset!.toLowerCase()) throw new Error("offer-settlement-mismatch");
        if (offer.reservationBond > 0n) {
          const bondApproval = await this.client.rpc.approve(vaultAsset, offer.vault, offer.reservationBond);
          await this.client.rpc.wait(bondApproval);
        }
        return this.client.rpc.coreWrite("acceptQuote", [{
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
        }]);
      },
    });
    try {
      await setup.resume();
    } catch (error) {
      throw new CollateralSetupInterruptedError(setup, error);
    }
    setup.credit.setup = setup;
    return setup.credit;
  }
}
