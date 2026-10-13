import type { CollateralMarket } from "@termbook/schema";
import { encodeFunctionData, type Abi } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { ContractWriteRequest, Wallet } from "../types/client.types.js";
import { EvmSourceLockWallet } from "../collateral/evm-source.js";
import type { SourceLockWallet } from "../collateral/setup.js";
import { walletProvider } from "../wallet/network.js";

export async function connectSourceWallet(client: TermbookClient, market: CollateralMarket,
  resolver?: (market: CollateralMarket) => Promise<SourceLockWallet>, signal?: AbortSignal): Promise<SourceLockWallet> {
  signal?.throwIfAborted();
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
  const provider = await walletProvider(client.config.wallet);
  const switchChain = (chain: number) => { signal?.throwIfAborted(); return client.network.ensure(provider, chain); };
  await switchChain(market.chainId);
  let accounts: unknown;
  try { accounts = await provider.request({ method: "eth_requestAccounts" }); }
  finally { await switchChain(client.config.chainId); }
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])) {
    throw new Error("source-wallet-unavailable");
  }
  const address = accounts[0] as `0x${string}`;
  const wallet: Wallet = {
    address,
    signTypedData: async () => { throw new Error("source-wallet-signing-unavailable"); },
    getChainId: async () => Number(await provider.request({ method: "eth_chainId" })),
    writeContract: async (request: ContractWriteRequest) => {
      signal?.throwIfAborted();
      const authorized = await provider.request({ method: "eth_accounts" });
      if (!Array.isArray(authorized) || typeof authorized[0] !== "string"
        || authorized[0].toLowerCase() !== address.toLowerCase()) throw new Error("source-wallet-changed");
      if (Number(await provider.request({ method: "eth_chainId" })) !== market.chainId) throw new Error("source-wallet-chain-mismatch");
      signal?.throwIfAborted();
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
  const onSource = async <T>(work: () => Promise<T>, restore = true): Promise<T> => {
    await switchChain(market.chainId);
    signal?.throwIfAborted();
    try { return await work(); } finally { if (restore) await switchChain(client.config.chainId); }
  };
  return {
    account: source.account,
    preflight: (binding) => onSource(() => source.preflight(binding)),
    remoteRecoveryVault: (binding) => source.remoteRecoveryVault(binding),
    observeLock: async (binding, lockId, txId) => {
      await switchChain(client.config.chainId);
      return source.observeLock(binding, lockId, txId);
    },
    // Persist submitted hashes before requesting the return to Monad.
    submitAction: (plan) => onSource(() => source.submitAction(plan), false),
    submitLock: (binding, lockId, revision) =>
      onSource(() => source.submitLock(binding, lockId, revision), false),
  };
}
