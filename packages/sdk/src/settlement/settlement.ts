import type { TermbookClient } from "../client/client.js";
import type { ReceiptView } from "./receipt.js";
import type { OperationKind } from "./operation.js";
import { operationId } from "./operation.js";
import { inboxFactoryAbi, sourceRecoveryVaultAbi } from "@termbook/bindings";
import { quoteHash, verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { createPublicClient, hashTypedData, http, keccak256, stringToHex } from "viem";
import type { Wallet } from "../types/client.types.js";
import { HttpClient } from "../transport/http.js";
import { solanaPubkeyBytes } from "../collateral/solana.js";

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const erc20TransferAbi = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;

type SettlementRegistrationBase = {
  operationId: `0x${string}`;
  registrationTxHash?: `0x${string}`;
  operation?: RecoveryOperation;
  kind: OperationKind;
  payer: `0x${string}`;
  sourceChain: number;
  sourceAsset: `0x${string}`;
  sourceRefund: `0x${string}`;
  inbox: `0x${string}`;
  amountIn: bigint;
  deadline: string;
  providerQuote: OneClickQuoteResponse;
};

export type SettlementRegistration = SettlementRegistrationBase & (
  | { sourceAddressFormat: "evm"; sourceRefundRecipient: `0x${string}`; depositAddress: `0x${string}` }
  | { sourceAddressFormat: "solana"; sourceRefundRecipient: string; depositAddress: string }
);

export type RecoveryOperation = {
  operationId: `0x${string}`;
  kind: number;
  payer: `0x${string}`;
  sourceChain: bigint;
  sourceAsset: `0x${string}`;
  vault: `0x${string}`;
  token: `0x${string}`;
  creditId: `0x${string}`;
  maxAmountIn: bigint;
  minOut: bigint;
  maxReceived: bigint;
  sourceRefund: `0x${string}`;
  refundRecipient: `0x${string}`;
  deadline: bigint;
  routeId: `0x${string}`;
  routeVersion: `0x${string}`;
  lpRecipient: `0x${string}`;
  minShares: bigint;
};

export type RecoveryProof = {
  header: `0x${string}`;
  proof: `0x${string}`;
  routeSignature: `0x${string}`;
  riskSignature: `0x${string}`;
};

export type RecoveryFunding = {
  creditId: `0x${string}`;
  operationId: `0x${string}`;
  inbox: `0x${string}`;
  depositAddress: `0x${string}`;
  amount: bigint;
  quoteHash: `0x${string}`;
  nonce: bigint;
  deadline: bigint;
};

export function settlementNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return BigInt(`0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`);
}

export class Settlement {
  client: TermbookClient;

  constructor(client: TermbookClient) {
    this.client = client;
  }

  async inboxStatus(inbox: `0x${string}`): Promise<ReceiptView> {
    await this.client.ready();
    if (!/^0x[a-fA-F0-9]{40}$/.test(inbox)) throw new Error("param-invalid");
    return this.client.rpc.inboxStatus(inbox);
  }

  async fundErc20(registration: SettlementRegistration, sourceRpcUrl: string, sourceWallet: Wallet): Promise<`0x${string}`> {
    if (registration.sourceAddressFormat !== "evm" || registration.kind === "recovery" || !sourceWallet.writeContract || sourceWallet.address.toLowerCase() !== registration.payer.toLowerCase()) throw new Error("source-wallet-required");
    if (!validEvmQuote(registration)) throw new Error("settlement-invalid");
    const chain = createPublicClient({ transport: http(sourceRpcUrl) });
    if (await chain.getChainId() !== registration.sourceChain) throw new Error("chain-mismatch");
    const tx = await sourceWallet.writeContract({
      address: registration.sourceAsset,
      abi: erc20TransferAbi,
      functionName: "transfer",
      args: [registration.depositAddress, registration.amountIn],
      account: sourceWallet.address,
    });
    const receipt = await chain.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error("source-transfer-reverted");
    return tx;
  }

  async recoveryFunding(registration: SettlementRegistration, recoveryVault: `0x${string}`, creditId: `0x${string}`, nonce: bigint, deadline: number): Promise<{
    funding: RecoveryFunding;
    typedData: unknown;
  }> {
    await this.client.ready();
    if (
      registration.sourceAddressFormat !== "evm" || registration.kind !== "recovery"
        || registration.sourceRefund.toLowerCase() !== recoveryVault.toLowerCase()
        || !validEvmQuote(registration) || nonce < 0n
        || deadline <= Date.now() / 1000 || !Number.isFinite(Date.parse(registration.deadline))
        || deadline > Date.parse(registration.deadline) / 1000
    ) throw new Error("recovery-route-invalid");
    const funding: RecoveryFunding = {
      creditId,
      operationId: registration.operationId,
      inbox: registration.inbox,
      depositAddress: registration.depositAddress,
      amount: registration.amountIn,
      quoteHash: keccak256(stringToHex(quoteHash(registration.providerQuote))),
      nonce,
      deadline: BigInt(deadline),
    };
    const typedData = {
      domain: { name: "Termbook", version: "1", chainId: registration.sourceChain, verifyingContract: recoveryVault },
      primaryType: "RecoveryFunding",
      types: { RecoveryFunding: [
        { name: "creditId", type: "bytes32" }, { name: "operationId", type: "bytes32" },
        { name: "inbox", type: "address" }, { name: "depositAddress", type: "address" },
        { name: "amount", type: "uint256" }, { name: "quoteHash", type: "bytes32" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        { name: "monadChain", type: "uint256" }, { name: "asset", type: "address" },
      ] },
      message: { ...funding, monadChain: BigInt(this.client.config.chainId), asset: registration.sourceAsset },
    };
    return { funding, typedData };
  }

  async approveRecoveryRisk(creditId: `0x${string}`, operationId: `0x${string}`): Promise<{ operationId: string; fundingDigest: string; state: string }> {
    await this.client.ready();
    if (!this.client.config.apiBase || !/^0x[a-fA-F0-9]{64}$/.test(creditId)
      || !/^0x[a-fA-F0-9]{64}$/.test(operationId)) throw new Error("recovery-risk-plan-required");
    const plan = await new HttpClient(this.client.config.apiBase).get<{
      operationId: `0x${string}`;
      riskSigner: `0x${string}`;
      fundingDigest: `0x${string}`;
      typedData: unknown;
    }>(`/recovery/risk-approval-plan?creditId=${creditId}&operationId=${operationId}`);
    if (plan.operationId.toLowerCase() !== operationId.toLowerCase()
      || plan.riskSigner.toLowerCase() !== this.client.signer.address().toLowerCase()
      || hashTypedData(plan.typedData as never).toLowerCase() !== plan.fundingDigest.toLowerCase()) {
      throw new Error("recovery-risk-plan-invalid");
    }
    const signature = await this.client.signer.sign(plan.typedData);
    return this.client.authenticatedPost("/recovery/risk-approval", {
      creditId, operationId, signature,
    });
  }

  async fundRecovery(registration: SettlementRegistration, recoveryVault: `0x${string}`, funding: RecoveryFunding, authorization: RecoveryProof, sourceRpcUrl: string, sourceWallet: Wallet): Promise<`0x${string}`> {
    const operation = registration.operation;
    if (
      registration.sourceAddressFormat !== "evm" || registration.kind !== "recovery"
        || registration.sourceRefund.toLowerCase() !== recoveryVault.toLowerCase()
        || !operation || operation.kind !== 1
        || operation.operationId.toLowerCase() !== registration.operationId.toLowerCase()
        || operation.creditId.toLowerCase() !== funding.creditId.toLowerCase()
        || operation.sourceChain !== BigInt(registration.sourceChain)
        || operation.sourceAsset.toLowerCase() !== registration.sourceAsset.toLowerCase()
        || operation.sourceRefund.toLowerCase() !== recoveryVault.toLowerCase()
        || operation.maxAmountIn !== funding.amount || operation.deadline < funding.deadline
        || funding.operationId.toLowerCase() !== registration.operationId.toLowerCase()
        || funding.inbox.toLowerCase() !== registration.inbox.toLowerCase()
        || funding.depositAddress.toLowerCase() !== registration.depositAddress.toLowerCase()
        || funding.amount !== registration.amountIn
        || funding.quoteHash !== keccak256(stringToHex(quoteHash(registration.providerQuote)))
        || !validEvmQuote(registration) || !sourceWallet.writeContract
        || !/^0x(?:[a-fA-F0-9]{2})+$/.test(authorization.header)
        || !/^0x(?:[a-fA-F0-9]{2})+$/.test(authorization.proof)
        || !/^0x(?:[a-fA-F0-9]{2})+$/.test(authorization.routeSignature)
        || !/^0x(?:[a-fA-F0-9]{2})+$/.test(authorization.riskSignature)
    ) throw new Error("recovery-route-invalid");
    const chain = createPublicClient({ transport: http(sourceRpcUrl) });
    if (await chain.getChainId() !== registration.sourceChain) throw new Error("chain-mismatch");
    const tx = await sourceWallet.writeContract({
      address: recoveryVault,
      abi: sourceRecoveryVaultAbi,
      functionName: "fund",
      args: [funding, operation, authorization.header, authorization.proof, authorization.routeSignature, authorization.riskSignature],
      account: sourceWallet.address,
    });
    const receipt = await chain.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error("source-transfer-reverted");
    return tx;
  }

  async register(input: {
    kind: OperationKind;
    payer: `0x${string}`;
    nonce: bigint;
    chainId: number;
    creditId?: `0x${string}`;
    routeVersion: `0x${string}`;
    routeId: `0x${string}`;
    asset: `0x${string}`;
    settlementAsset: `0x${string}`;
    vault: `0x${string}`;
    maxAmountIn: bigint;
    minAmountOut: bigint;
    maxReceived: bigint;
    deadline: number;
    sourceRefund: `0x${string}`;
    sourceAddressFormat?: "evm" | "solana";
    sourceRefundRecipient?: string;
    monadRefund: `0x${string}`;
    lpRecipient?: `0x${string}`;
    minShares?: bigint;
    registrationTxHash?: `0x${string}`;
  }): Promise<SettlementRegistration> {
    await this.client.ready();
    const factory = this.client.config.settlementFactory;
    if (!factory || input.payer.toLowerCase() !== this.client.signer.address().toLowerCase() || !input.routeVersion || input.maxAmountIn <= 0n || input.maxReceived < input.minAmountOut || input.deadline <= Date.now() / 1000) throw new Error("settlement-route-required");
    const sourceAddressFormat = input.sourceAddressFormat ?? "evm";
    const sourceRefundRecipient = input.sourceRefundRecipient ?? input.sourceRefund;
    if ((sourceAddressFormat !== "evm" && sourceAddressFormat !== "solana")
      || !/^0x[a-fA-F0-9]{40}$/.test(input.sourceRefund)
      || (sourceAddressFormat === "evm" && (!/^0x[a-fA-F0-9]{40}$/.test(sourceRefundRecipient)
        || sourceRefundRecipient.toLowerCase() !== input.sourceRefund.toLowerCase()))
      || (sourceAddressFormat === "solana" && (!input.sourceRefundRecipient
        || !isSolanaPubkey(sourceRefundRecipient)))) throw new Error("settlement-route-required");
    const id = operationId({ kind: input.kind, payer: input.payer, nonce: input.nonce, chainId: input.chainId, creditId: input.creditId, routeVersion: input.routeVersion, asset: input.asset, vault: input.vault });
    const kind = input.kind === "repay" ? 0 : input.kind === "recovery" ? 1 : 2;
    const operation: RecoveryOperation = {
      operationId: id,
      kind,
      payer: input.payer,
      sourceChain: BigInt(input.chainId),
      sourceAsset: input.asset,
      vault: input.vault,
      token: input.settlementAsset,
      creditId: input.creditId ?? zeroBytes32,
      maxAmountIn: input.maxAmountIn,
      minOut: input.minAmountOut,
      maxReceived: input.maxReceived,
      sourceRefund: input.sourceRefund,
      refundRecipient: input.monadRefund,
      deadline: BigInt(input.deadline),
      routeId: input.routeId,
      routeVersion: input.routeVersion,
      lpRecipient: input.lpRecipient ?? zeroAddress,
      minShares: input.minShares ?? 0n,
    };
    const inboxBefore = await this.client.rpc.read<`0x${string}`>(factory, inboxFactoryAbi, "inboxOf", [id]);
    let registrationTxHash = input.registrationTxHash;
    if (inboxBefore.toLowerCase() === zeroAddress) {
      const signature = await this.client.signer.sign({
        domain: { name: "Termbook", version: "1", chainId: this.client.config.chainId, verifyingContract: factory },
        primaryType: "SettlementOperation",
        types: { SettlementOperation: [
          { name: "operationId", type: "bytes32" }, { name: "kind", type: "uint8" },
          { name: "payer", type: "address" }, { name: "sourceChain", type: "uint256" },
          { name: "sourceAsset", type: "address" }, { name: "vault", type: "address" },
          { name: "token", type: "address" }, { name: "creditId", type: "bytes32" },
          { name: "maxAmountIn", type: "uint256" }, { name: "minOut", type: "uint256" },
          { name: "maxReceived", type: "uint256" }, { name: "sourceRefund", type: "address" },
          { name: "refundRecipient", type: "address" }, { name: "deadline", type: "uint256" },
          { name: "routeId", type: "bytes32" }, { name: "routeVersion", type: "bytes32" },
          { name: "lpRecipient", type: "address" }, { name: "minShares", type: "uint256" },
        ] },
        message: operation,
      });
      const wormholeFee = input.kind === "recovery" && operation.sourceChain === 1n
        ? await this.client.rpc.ethereumFactoryWormholeFee(factory) : undefined;
      const tx = await this.client.rpc.write(factory, inboxFactoryAbi, "createAuthorized",
        [operation, signature], wormholeFee);
      await this.client.rpc.wait(tx);
      registrationTxHash = tx;
    }
    if (input.kind === "recovery" && (!registrationTxHash || !/^0x[a-fA-F0-9]{64}$/.test(registrationTxHash))) {
      throw new Error("recovery-registration-tx-required");
    }
    const inbox = await this.client.rpc.read<`0x${string}`>(factory, inboxFactoryAbi, "inboxOf", [id]);
    if (inbox.toLowerCase() === zeroAddress) throw new Error("settlement-invalid");
    const until = Date.now() + 60_000;
    while ((await this.client.rpc.client.readContract({ address: factory, abi: inboxFactoryAbi, functionName: "inboxOf", args: [id], blockTag: "finalized" })).toLowerCase() !== inbox.toLowerCase()) {
      if (Date.now() > until) throw new Error("settlement-finality-timeout");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const result = await this.client.authenticatedPost<{ operationId?: string; inbox?: string; quote?: OneClickQuoteResponse }>("/settlement", {
      operationId: id,
      registrationTxHash,
      kind: input.kind,
      nonce: input.nonce.toString(),
      sourceChain: input.chainId,
      sourceAsset: input.asset,
      token: input.settlementAsset,
      maxAmountIn: input.maxAmountIn.toString(),
      maxReceived: input.maxReceived.toString(),
      minAmountOut: input.minAmountOut.toString(),
      vault: input.vault,
      creditId: input.creditId,
      payer: input.payer,
      deadline: input.deadline,
      refundRecipient: input.monadRefund,
      sourceRefundRecipient,
      monadRefundRecipient: input.monadRefund,
      routeVersion: input.routeVersion,
      routeId: input.routeId,
      lpRecipient: input.lpRecipient,
      minShares: input.minShares?.toString(),
    });
    const providerQuote = result.quote;
    const quote = providerQuote?.quote;
    const quotedRequest = providerQuote?.quoteRequest;
    const quoteDeadline = Date.parse(quote?.deadline ?? "");
    if (
      result.operationId?.toLowerCase() !== id.toLowerCase() || result.inbox?.toLowerCase() !== inbox.toLowerCase()
        || !providerQuote || !quotedRequest || !verifyQuoteSignature(providerQuote)
        || quotedRequest.recipient.toLowerCase() !== inbox.toLowerCase()
        || (sourceAddressFormat === "evm"
          ? quotedRequest.refundTo.toLowerCase() !== sourceRefundRecipient.toLowerCase()
          : quotedRequest.refundTo !== sourceRefundRecipient)
        || quotedRequest.amount !== input.maxAmountIn.toString()
        || !quote?.depositAddress || (sourceAddressFormat === "evm"
          ? !/^0x[a-fA-F0-9]{40}$/.test(quote.depositAddress)
          : !isSolanaPubkey(quote.depositAddress)) || quote.depositMemo
        || !quote.amountIn || BigInt(quote.amountIn) !== input.maxAmountIn
        || BigInt(quote.minAmountOut) < input.minAmountOut
        || BigInt(quote.amountOut) > input.maxReceived
        || !quote.deadline || !Number.isFinite(quoteDeadline) || quoteDeadline <= Date.now()
        || quoteDeadline > input.deadline * 1000
    ) throw new Error("settlement-invalid");
    const registration = { operationId: id, registrationTxHash, operation, kind: input.kind, payer: input.payer,
      sourceChain: input.chainId, sourceAsset: input.asset, sourceRefund: input.sourceRefund, inbox,
      amountIn: BigInt(quote.amountIn), deadline: quote.deadline, providerQuote };
    if (sourceAddressFormat === "solana") {
      return { ...registration, sourceAddressFormat, sourceRefundRecipient, depositAddress: quote.depositAddress };
    }
    return { ...registration, sourceAddressFormat, sourceRefundRecipient: sourceRefundRecipient as `0x${string}`,
      depositAddress: quote.depositAddress as `0x${string}` };
  }
}

function isSolanaPubkey(value: string): boolean {
  try { solanaPubkeyBytes(value); return true; } catch { return false; }
}

function validEvmQuote(registration: SettlementRegistration): boolean {
  if (registration.sourceAddressFormat !== "evm") return false;
  const quote = registration.providerQuote;
  return /^0x[a-fA-F0-9]{40}$/.test(registration.depositAddress)
    && /^0x[a-fA-F0-9]{40}$/.test(registration.sourceRefundRecipient)
    && registration.sourceRefundRecipient.toLowerCase() === registration.sourceRefund.toLowerCase()
    && verifyQuoteSignature(quote)
    && quote.quoteRequest?.recipient?.toLowerCase() === registration.inbox.toLowerCase()
    && quote.quoteRequest?.refundTo?.toLowerCase() === registration.sourceRefundRecipient.toLowerCase()
    && quote.quote?.depositAddress?.toLowerCase() === registration.depositAddress.toLowerCase()
    && BigInt(quote.quote.amountIn) === registration.amountIn
    && quote.quote.deadline === registration.deadline
    && Number.isFinite(Date.parse(registration.deadline))
    && Date.parse(registration.deadline) > Date.now();
}
