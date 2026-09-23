import type { TermbookClient } from "../client/client.js";
import type { EvmCollateralSelection, IntentRequest } from "../types/intent.types.js";
import { Credit } from "../credit/credit.js";
import { HttpClient } from "../transport/http.js";
import { encodeAbiParameters, keccak256 } from "viem";
import { collateralSelectionSchema, NATIVE_SOL_ASSET_BYTES, type CollateralSetupBinding, type CollateralSetupCheckpoint } from "@termbook/schema";
import { CollateralChainNotIntegratedError, CollateralSetup, CollateralSetupInterruptedError, type CollateralProofSource, type SourceLockWallet } from "../collateral/setup.js";
import { EvmSourceLockWallet, type EvmSourceWalletConfig } from "../collateral/evm-source.js";
import { solanaAlias } from "../collateral/solana.js";

type SolanaOfferIdentity = {
  sourceGenesis: `0x${string}`;
  sourceVault: `0x${string}`;
  sourceAsset: typeof NATIVE_SOL_ASSET_BYTES;
  sourceOwner: `0x${string}`;
  returnRecipient: `0x${string}`;
  recoveryVault: `0x${string}`;
  verifierVersion: bigint;
};

export type Offer = {
  kind?: "evm" | "solana";
  solana?: SolanaOfferIdentity;
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
  source_wallet?: EvmSourceWalletConfig | SourceLockWallet;
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

function solanaId(value: unknown): `0x${string}` {
  const id = bytes32(value).toLowerCase() as `0x${string}`;
  if (/^0x0{64}$/.test(id)) throw new Error("offer-invalid");
  return id;
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
  const kind = raw["kind"] === "solana" ? "solana" : raw["kind"] === "evm" || raw["kind"] === undefined ? "evm" : undefined;
  if (!kind || (kind === "evm" && raw["solana"] !== undefined)) throw new Error("offer-invalid");
  const source = kind === "solana" ? raw["solana"] as Record<string, unknown> | undefined : undefined;
  const solana = source ? {
    sourceGenesis: solanaId(source["sourceGenesis"]),
    sourceVault: solanaId(source["sourceVault"]),
    sourceAsset: solanaId(source["sourceAsset"]) as typeof NATIVE_SOL_ASSET_BYTES,
    sourceOwner: solanaId(source["sourceOwner"]),
    returnRecipient: solanaId(source["returnRecipient"]),
    recoveryVault: solanaId(source["recoveryVault"]),
    verifierVersion: BigInt(String(source["verifierVersion"])),
  } : undefined;
  if (kind === "solana" && (!solana || solana.sourceAsset !== NATIVE_SOL_ASSET_BYTES || solana.verifierVersion <= 0n || solana.verifierVersion > (1n << 64n) - 1n)) throw new Error("offer-invalid");
  return {
    id,
    kind,
    solana,
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

function quoteForCore(offer: Offer) {
  return {
    borrower: offer.borrower, owner: offer.owner, intentId: offer.intentId,
    house: offer.house, vault: offer.vault, sourceChain: BigInt(offer.sourceChain!),
    collateralVault: offer.collateralVault, collateralAsset: offer.collateralAsset,
    collateralAmount: offer.collateralAmount, returnRecipient: offer.returnRecipient,
    settlementAsset: offer.settlementAsset, limit: offer.limit, bundleId: offer.bundleId,
    setupDeadline: BigInt(offer.setupDeadline), maturity: BigInt(offer.maturity),
    gracePeriod: BigInt(offer.grace), reservationBond: offer.reservationBond,
    nonce: offer.nonce, expiry: BigInt(offer.expiry), termsHash: offer.termsHash,
    revolving: offer.revolving, aprBps: BigInt(offer.aprBps),
    originationFee: offer.originationFee, commitmentFeeBps: BigInt(offer.commitmentFeeBps),
    signature: offer.signature,
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
    const base = this.client.config.apiBase;
    if (!base) throw new Error("api-required");
    const selection = request.collateral;
    const common = {
      borrower: this.client.signer.address(),
      duration: request.credit.duration,
      action: request.action,
      limit: request.credit.limit?.toString(),
    };
    const collateral = "chain" in selection && selection.chain.namespace === "solana"
      ? (() => {
          if (selection.asset.namespace !== "solana" || selection.asset.kind !== "native" || selection.asset.assetBytes !== NATIVE_SOL_ASSET_BYTES) throw new CollateralChainNotIntegratedError("solana-asset");
          return { ...common, collateral: { ...collateralSelectionSchema.parse(selection), amount: selection.amount.toString() } };
        })()
      : (() => {
          const evm = this.evmCollateral();
          return { ...common, chainId: evm.chainId, asset: evm.asset, amount: evm.amount.toString(), owner: evm.owner, recipient: evm.recipient };
        })();
    const response = await this.client.authenticatedPost<{ intentId?: string; intent_id?: string }>("/intents", collateral);
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
    const requested = this.requiredRequest().collateral;
    if ("chain" in requested && requested.chain.namespace === "solana") return this.acceptSolana(args);
    const collateral = this.evmCollateral();
    const offerId = args.offer_id ?? args.offerId;
    if (!offerId) throw new Error("offer-required");
    const offer = (await this.offers()).find((item) => item.id === offerId);
    if (!offer) throw new Error("offer-not-found");
    if (offer.kind === "solana") throw new Error("offer-collateral-mismatch");
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
      ? "submitLock" in args.source_wallet ? args.source_wallet as SourceLockWallet : new EvmSourceLockWallet(args.source_wallet)
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
        return this.client.rpc.coreWrite("acceptQuote", [quoteForCore(offer)]);
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

  private async acceptSolana(args: AcceptOptions): Promise<Credit> {
    const requested = this.requiredRequest().collateral;
    if (!("chain" in requested) || requested.chain.namespace !== "solana") throw new Error("solana-selection-required");
    const selection = collateralSelectionSchema.parse(requested);
    const offerId = args.offer_id ?? args.offerId;
    if (!offerId) throw new Error("offer-required");
    const offer = (await this.offers()).find((item) => item.id === offerId);
    if (!offer || offer.kind !== "solana" || !offer.solana) throw new Error("offer-not-found");
    const source = offer.solana;
    if (offer.borrower.toLowerCase() !== this.client.signer.address().toLowerCase()) throw new Error("unauthorized");
    if (offer.owner === undefined || offer.sourceChain === undefined || offer.collateralVault === undefined
      || offer.collateralAsset === undefined || offer.collateralAmount === undefined || offer.returnRecipient === undefined
      || offer.settlementAsset === undefined) throw new Error("offer-collateral-unbound");
    if (selection.asset.namespace !== "solana" || selection.owner.namespace !== "solana" || selection.returnRecipient.namespace !== "solana"
      || source.sourceGenesis !== selection.chain.reference || source.sourceAsset !== selection.asset.assetBytes
      || source.sourceOwner !== selection.owner.accountBytes || source.returnRecipient !== selection.returnRecipient.accountBytes
      || offer.collateralAmount !== selection.amount || offer.owner.toLowerCase() !== solanaAlias(source.sourceGenesis, source.sourceOwner).toLowerCase()
      || offer.collateralVault.toLowerCase() !== solanaAlias(source.sourceGenesis, source.sourceVault).toLowerCase()
      || offer.collateralAsset.toLowerCase() !== solanaAlias(source.sourceGenesis, source.sourceAsset).toLowerCase()
      || offer.returnRecipient.toLowerCase() !== solanaAlias(source.sourceGenesis, source.returnRecipient).toLowerCase()) throw new Error("offer-collateral-mismatch");
    const wallet = args.source_wallet;
    if (!wallet || !("submitLock" in wallet)) throw new Error("solana-source-wallet-required");
    const sourceWallet = wallet as SourceLockWallet;
    const creditId = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [offer.intentId, offer.borrower, offer.house, offer.nonce],
    ));
    const sourceRef = { namespace: "solana" as const, reference: source.sourceGenesis };
    const binding: CollateralSetupBinding = {
      version: 1, monadChainId: this.client.config.chainId, core: this.client.config.core,
      creditId, intentId: offer.intentId, termsHash: offer.termsHash, borrower: offer.borrower,
      house: offer.house, sourceVault: { ...sourceRef, accountBytes: source.sourceVault },
      asset: { ...sourceRef, kind: "native", assetBytes: source.sourceAsset }, amount: offer.collateralAmount,
      owner: { ...sourceRef, accountBytes: source.sourceOwner },
      returnRecipient: { ...sourceRef, accountBytes: source.returnRecipient },
      recoveryVault: { ...sourceRef, accountBytes: source.recoveryVault },
      sourceChainId: offer.sourceChain, verifierVersion: source.verifierVersion,
      setupDeadline: offer.setupDeadline, nonce: offer.nonce,
    };
    const setup = new CollateralSetup(this.client, binding, {
      sourceWallet, proofSource: args.proof_source, checkpoint: args.checkpoint,
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
        return this.client.rpc.coreWrite("acceptSolanaQuote", [{
          quote: quoteForCore(offer), sourceGenesis: source.sourceGenesis,
          sourceVault: source.sourceVault, sourceAsset: source.sourceAsset,
          sourceOwner: source.sourceOwner, returnRecipient: source.returnRecipient,
          recoveryVault: source.recoveryVault, verifierVersion: source.verifierVersion,
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
