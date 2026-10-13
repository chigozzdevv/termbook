import { base, baseSepolia, mainnet, monad, monadTestnet, sepolia } from "viem/chains";
import type { Wallet } from "../types/client.types.js";

const chains = [mainnet, sepolia, base, baseSepolia, monad, monadTestnet];
type Provider = Pick<Wallet, "request"> & { request: NonNullable<Wallet["request"]> };
export type NetworkPrompt = { chainId: number; name: string; action: "switch" | "add"; approve: () => Promise<void> };
type PromptContext = { handler: (prompt: NetworkPrompt) => Promise<void>; signal: AbortSignal };

export async function walletProvider(wallet: Wallet): Promise<Provider> {
  const injected = (globalThis as typeof globalThis & { ethereum?: Provider }).ethereum;
  const provider = wallet.request ? { request: wallet.request } : injected;
  if (!provider?.request) throw new Error("source-wallet-unavailable");
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string"
    || accounts[0].toLowerCase() !== wallet.address.toLowerCase()) throw new Error("wallet-account-mismatch");
  return provider;
}

export function networkName(chainId: number): string {
  return chains.find((chain) => chain.id === chainId)?.name.replace("Testnet", "testnet") ?? `Chain ${chainId}`;
}

export function networkErrorCode(error: unknown): number | undefined {
  let current = error;
  let code: number | undefined;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth++) {
    const value = current as { code?: number; cause?: unknown };
    if (typeof value.code === "number") code = value.code;
    current = value.cause;
  }
  return code;
}

export const needsNetworkAddition = (error: unknown): boolean => networkErrorCode(error) === 4902;

export function networkNotice(error: unknown, prompt: NetworkPrompt): string {
  switch (networkErrorCode(error)) {
    case 4001: return `Request declined. Click ${prompt.action === "add" ? "Add network" : "Switch network"} to try again.`;
    case -32002: return "Complete the pending request in your wallet, then try again.";
    case 4100: return "Reconnect your wallet and approve account access.";
    case 4900:
    case 4901: return "Open your wallet and reconnect, then try again.";
    case 4200:
    case -32601: return `Select ${prompt.name} in your wallet, then try again.`;
    default: return `Select ${prompt.name} in your wallet, then try again.`;
  }
}

export class WalletNetwork {
  private context?: PromptContext;
  private pending = false;

  listen(handler: PromptContext["handler"], signal: AbortSignal): () => void {
    const context = { handler, signal };
    this.context = context;
    return () => { if (this.context === context) this.context = undefined; };
  }

  async ensure(provider: Provider, chainId: number): Promise<void> {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("wallet-network-invalid");
    if (this.pending) throw new Error("wallet-network-busy");
    this.pending = true;
    const context = this.context;
    const active = () => context?.signal.throwIfAborted();
    const selected = async () => {
      active();
      const current = await provider.request({ method: "eth_chainId" });
      active();
      return Number(current) === chainId;
    };
    const hex = `0x${chainId.toString(16)}`;
    const switchChain = async () => {
      active();
      if (!await selected()) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      active();
      if (!await selected()) throw new Error("wallet-network-mismatch");
    };
    const request = async (action: NetworkPrompt["action"], approve: () => Promise<void>) => {
      active();
      const prompt = { chainId, name: networkName(chainId), action, approve };
      if (context) await context.handler(prompt); else await approve();
      active();
    };
    try {
      if (await selected()) return;
      try { await request("switch", switchChain); }
      catch (error) {
        active();
        if (!needsNetworkAddition(error)) throw error;
        const chain = chains.find((value) => value.id === chainId);
        if (!chain) throw new Error("wallet-network-unsupported", { cause: error });
        await request("add", async () => {
          active();
          await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex,
            chainName: chain.name, nativeCurrency: chain.nativeCurrency,
            rpcUrls: [...chain.rpcUrls.default.http],
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
          }] });
          active();
          await switchChain();
        });
      }
      if (!await selected()) throw new Error("wallet-network-mismatch");
    } finally { this.pending = false; }
  }
}
