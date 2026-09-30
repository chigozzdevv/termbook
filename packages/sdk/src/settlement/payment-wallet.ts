import { createPublicClient, decodeFunctionData, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import type { Wallet } from "../types/client.types.js";
import type { SettlementRegistration } from "./settlement.js";
import type { PaymentRoute, PaymentSourceWallet, SourcePaymentSubmission } from "./payment-types.js";

const transferAbi = parseAbi(["function transfer(address to,uint256 amount) returns (bool)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function evmPaymentWallet(wallet: Wallet): PaymentSourceWallet {
  return { address: wallet.address, async fund(registration, route, onSubmitted) {
    if (route.sourceAddressFormat !== "evm" || !wallet.writeContract) throw new Error("source-wallet-required");
    if (wallet.getChainId && await wallet.getChainId() !== route.sourceChain) throw new Error("source-wallet-chain-mismatch");
    if (route.sourceKind === "native") throw new Error("native-payment-wallet-required");
    const tx = await wallet.writeContract({ address: route.sourceAsset, abi: transferAbi,
      functionName: "transfer", args: [registration.depositAddress, registration.amountIn], account: wallet.address });
    await onSubmitted(tx);
    return tx;
  } };
}
export async function connectPaymentWallet(route: PaymentRoute, monadChain: number): Promise<PaymentSourceWallet> {
  if (route.sourceAddressFormat === "solana") {
    const { solanaPaymentWallet } = await import("./solana-payment.js");
    return solanaPaymentWallet(route);
  }
  const provider = (globalThis as typeof globalThis & { ethereum?: {
    request(request: { method: string; params?: unknown[] }): Promise<unknown>;
  } }).ethereum;
  if (!provider) throw new Error("source-wallet-required");
  const switchTo = async (id: number) => {
    const hex = `0x${id.toString(16)}`;
    if (await provider.request({ method: "eth_chainId" }) !== hex) {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    }
    if (await provider.request({ method: "eth_chainId" }) !== hex) throw new Error("source-wallet-chain-mismatch");
  };
  let accounts: unknown;
  try {
    await switchTo(route.sourceChain);
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } finally { await switchTo(monadChain); }
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("source-wallet-required");
  return { address, async fund(registration, current, onSubmitted) {
    try {
      await switchTo(current.sourceChain);
      const authorized = await provider.request({ method: "eth_accounts" });
      if (!Array.isArray(authorized) || !authorized.some((value) => typeof value === "string" && same(value, address))) throw new Error("source-wallet-changed");
      const native = current.sourceKind === "native";
      const tx = await provider.request({ method: "eth_sendTransaction", params: [{ from: address,
        to: native ? registration.depositAddress : current.sourceAsset,
        value: `0x${(native ? registration.amountIn : 0n).toString(16)}`,
        data: native ? "0x" : encodeFunctionData({ abi: transferAbi, functionName: "transfer",
          args: [registration.depositAddress as Hex, registration.amountIn] }) }] });
      if (typeof tx !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(tx)) throw new Error("source-transaction-invalid");
      await onSubmitted(tx);
      return tx;
    } finally { await switchTo(monadChain); }
  } };
}
export async function verifyPaymentTransfer(route: PaymentRoute, registration: SettlementRegistration,
  sourceTx: string, sender: string, submission?: SourcePaymentSubmission): Promise<boolean> {
  if (route.sourceAddressFormat === "solana") {
    const { verifySolanaPayment } = await import("./solana-payment.js");
    return verifySolanaPayment(route, registration, sourceTx, sender, submission);
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(sourceTx)) throw new Error("source-transaction-invalid");
  const chain = createPublicClient({ transport: http(route.sourceRpcUrl) });
  if (await chain.getChainId() !== route.sourceChain) throw new Error("source-chain-mismatch");
  const receipt = await chain.getTransactionReceipt({ hash: sourceTx as Hex }).catch(() => undefined);
  if (!receipt) return false;
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) return false;
  const [block, tx] = await Promise.all([
    chain.getBlock({ blockNumber: receipt.blockNumber }), chain.getTransaction({ hash: sourceTx as Hex }),
  ]);
  if (!same(block.hash, receipt.blockHash) || !same(block.transactions[receipt.transactionIndex]!, sourceTx)
    || !same(tx.from, sender) || receipt.status !== "success") throw new Error("source-transfer-invalid");
  if (route.sourceKind === "native") {
    if (!tx.to || !same(tx.to, registration.depositAddress) || tx.value !== registration.amountIn || tx.input !== "0x") throw new Error("source-transfer-invalid");
  } else {
    if (!tx.to || !same(tx.to, route.sourceAsset) || tx.value !== 0n) throw new Error("source-transfer-invalid");
    const decoded = decodeFunctionData({ abi: transferAbi, data: tx.input });
    if (!same(decoded.args[0], registration.depositAddress) || decoded.args[1] !== registration.amountIn) throw new Error("source-transfer-invalid");
    const transfer = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
    const { parseEventLogs } = await import("viem");
    const delivered = parseEventLogs({ abi: transfer, logs: receipt.logs.filter((log) => same(log.address, route.sourceAsset)) })
      .filter((event) => same(event.args.from, sender) && same(event.args.to, registration.depositAddress))
      .reduce((amount, event) => amount + event.args.value, 0n);
    if (delivered !== registration.amountIn) throw new Error("source-transfer-invalid");
  }
  return true;
}

export async function verifySourceRefund(route: PaymentRoute, registration: SettlementRegistration,
  hashes: string[], amount: bigint): Promise<boolean> {
  if (amount <= 0n || amount > registration.amountIn || hashes.length === 0 || hashes.length > 16) return false;
  if (route.sourceAddressFormat === "solana") {
    const { verifySolanaRefund } = await import("./solana-payment.js");
    return verifySolanaRefund(route, registration, hashes, amount);
  }
  const chain = createPublicClient({ transport: http(route.sourceRpcUrl) });
  if (await chain.getChainId() !== route.sourceChain) throw new Error("source-chain-mismatch");
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  const { parseEventLogs } = await import("viem");
  const transfer = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
  let returned = 0n;
  for (const hash of new Set(hashes)) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) return false;
    const receipt = await chain.getTransactionReceipt({ hash: hash as Hex }).catch(() => undefined);
    if (!receipt || receipt.status !== "success" || receipt.blockNumber > finalized.number) continue;
    const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
    if (!same(block.hash, receipt.blockHash) || !same(block.transactions[receipt.transactionIndex]!, hash)) throw new Error("source-refund-noncanonical");
    if (route.sourceKind === "native") {
      const tx = await chain.getTransaction({ hash: hash as Hex });
      if (tx.to && same(tx.to, registration.sourceRefundRecipient) && tx.input === "0x") returned += tx.value;
    } else {
      returned += parseEventLogs({ abi: transfer, logs: receipt.logs.filter((log) => same(log.address, route.sourceAsset)) })
        .filter((event) => same(event.args.to, registration.sourceRefundRecipient))
        .reduce((sum, event) => sum + event.args.value, 0n);
    }
  }
  return returned >= amount;
}
