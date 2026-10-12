import { env } from "../config/env.js";

export function ethereumSourceChain(): number {
  return env.monadChainId === 10143 ? 11155111 : 1;
}

export function ethereumWormholeChain(): number {
  return env.monadChainId === 10143 ? 10002 : 2;
}

export function monadWormholeChain(): number {
  return env.monadChainId === 10143 ? 10009 : 48;
}

export function isEvmSource(chain: number | bigint): boolean {
  return env.monadChainId === 10143 ? chain === 11155111 || chain === 11155111n || chain === 84532 || chain === 84532n
    : env.monadChainId === 143 && (chain === 1 || chain === 1n || chain === 8453 || chain === 8453n);
}

export function evmWormholeChain(chain: number | bigint): number {
  if (!isEvmSource(chain)) throw new Error("evm-source-chain-unsupported");
  return ({ 1: 2, 11155111: 10002, 8453: 30, 84532: 10004 } as Record<string, number>)[String(chain)]!;
}

export function configuredEvmSources(): { chainId: number; rpcUrl: string }[] {
  let parsed: unknown;
  try { parsed = JSON.parse(env.evmSourceRpcUrls ?? "{}"); } catch { throw new Error("evm-source-config-invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("evm-source-config-invalid");
  const sources = new Map<number, string>();
  if (env.sourceRpcUrl) sources.set(ethereumSourceChain(), env.sourceRpcUrl);
  for (const [id, endpoint] of Object.entries(parsed)) {
    const chainId = Number(id);
    if (!isEvmSource(chainId) || String(chainId) !== id || typeof endpoint !== "string"
      || sources.has(chainId) && sources.get(chainId) !== endpoint) throw new Error("evm-source-config-invalid");
    sources.set(chainId, endpoint);
  }
  return [...sources].map(([chainId, rpcUrl]) => {
    let endpoint: URL;
    try { endpoint = new URL(rpcUrl); } catch { throw new Error("evm-source-config-invalid"); }
    if (!["http:", "https:"].includes(endpoint.protocol) || !isEvmSource(chainId)) throw new Error("evm-source-config-invalid");
    return { chainId, rpcUrl };
  });
}

export function evmSourceRpcUrl(chain: number | bigint): string {
  const source = configuredEvmSources().find((entry) => BigInt(entry.chainId) === BigInt(chain));
  if (!source) throw new Error("evm-source-unconfigured");
  return source.rpcUrl;
}
