import type { CollateralMarket } from "@termbook/schema";
import { encodeFunctionData, type Abi } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { ContractWriteRequest, Wallet } from "../types/client.types.js";
import { EvmSourceLockWallet } from "../collateral/evm-source.js";
import type { SourceLockWallet } from "../collateral/setup.js";

type Provider = { request(request: { method: string; params?: unknown[] }): Promise<unknown> };

function injectedProvider(): Provider {
  const provider = (globalThis as typeof globalThis & { ethereum?: Provider }).ethereum;
  if (!provider || typeof provider.request !== "function") throw new Error("source-wallet-unavailable");
  return provider;
}

function chainHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

async function switchChain(provider: Provider, chainId: number): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" });
  if (current === chainHex(chainId)) return;
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex(chainId) }] });
  if (await provider.request({ method: "eth_chainId" }) !== chainHex(chainId)) throw new Error("source-wallet-chain-mismatch");
}

export async function connectSourceWallet(client: TermbookClient, market: CollateralMarket,
  resolver?: (market: CollateralMarket) => Promise<SourceLockWallet>): Promise<SourceLockWallet> {
  if (resolver) return resolver(market);
  if (market.kind === "solana") {
    const { connectSolanaBrowserSourceWallet } = await import("../collateral/solana-browser.js");
    return connectSolanaBrowserSourceWallet(market);
  }
  await client.ready();
  if (market.chainId === client.config.chainId) {
    return new EvmSourceLockWallet({ chainId: market.chainId, rpcUrl: market.rpcUrl, wallet: client.config.wallet,
      vault: market.vault as `0x${string}`, asset: market.asset as `0x${string}`,
      controller: client.config.core, nativeVault: market.nativeVault });
  }
  const provider = injectedProvider();
  await switchChain(provider, market.chainId);
  let accounts: unknown;
  try { accounts = await provider.request({ method: "eth_requestAccounts" }); }
  finally { await switchChain(provider, client.config.chainId); }
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])) {
    throw new Error("source-wallet-unavailable");
  }
  const address = accounts[0] as `0x${string}`;
  const wallet: Wallet = {
    address,
    signTypedData: async () => { throw new Error("source-wallet-signing-unavailable"); },
    getChainId: async () => Number(await provider.request({ method: "eth_chainId" })),
    writeContract: async (request: ContractWriteRequest) => {
      const data = encodeFunctionData({ abi: request.abi as Abi, functionName: request.functionName, args: request.args ?? [] });
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: address,
        to: request.address, data, value: request.value === undefined ? undefined : `0x${request.value.toString(16)}` }] });
      if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("source-transaction-invalid");
      return hash as `0x${string}`;
    },
  };
  const source = new EvmSourceLockWallet({ chainId: market.chainId, rpcUrl: market.rpcUrl, wallet,
    vault: market.vault as `0x${string}`, asset: market.asset as `0x${string}`,
    controller: market.controller as `0x${string}`, nativeVault: market.nativeVault, testnetConfirmations: market.testnetConfirmations, testnetFinality: market.testnetFinality,
    ...(market.wrapNative ? { wrapNative: true } : {}) });
  const onSource = async <T>(work: () => Promise<T>): Promise<T> => {
    await switchChain(provider, market.chainId);
    try { return await work(); } finally { await switchChain(provider, client.config.chainId); }
  };
  return {
    account: source.account,
    preflight: (binding) => onSource(() => source.preflight(binding)),
    remoteRecoveryVault: (binding) => source.remoteRecoveryVault(binding),
    observeLock: (binding, lockId, txId) => source.observeLock(binding, lockId, txId),
    submitAction: (plan) => onSource(() => source.submitAction(plan)),
    submitLock: (binding, lockId, revision) =>
      onSource(() => source.submitLock(binding, lockId, revision)),
  };
}
