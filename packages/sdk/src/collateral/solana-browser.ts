import { Connection, PublicKey } from "@solana/web3.js";
import { hexToBytes } from "viem";
import type { CollateralMarket } from "@termbook/schema";
import { SolanaSourceLockWallet } from "./solana-source.js";
import { solanaPubkeyBase58 } from "./solana.js";
import { SolanaRpcWallet, type SolanaProvider, type SolanaRpcOptions } from "./solana-rpc.js";

function injectedSolanaProvider(): SolanaProvider {
  const scope = globalThis as typeof globalThis & {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  };
  const provider = scope.phantom?.solana ?? scope.solana;
  if (!provider || typeof provider.connect !== "function"
    || typeof provider.signTransaction !== "function") throw new Error("solana-wallet-unavailable");
  return provider;
}

const encoder = new TextEncoder();
function pda(seeds: Uint8Array[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

export class SolanaBrowserWallet extends SolanaRpcWallet {
  static async connect(rpcUrl: string, options: SolanaRpcOptions = {}): Promise<SolanaBrowserWallet> {
    const provider = injectedSolanaProvider();
    await provider.connect();
    const publicKey = provider.publicKey?.toBase58();
    if (!publicKey) throw new Error("solana-wallet-unavailable");
    new PublicKey(publicKey);
    return new SolanaBrowserWallet(provider, new Connection(rpcUrl, "finalized"), publicKey, options);
  }

}

export async function connectSolanaBrowserSourceWallet(market: CollateralMarket) {
  if (market.kind !== "solana") throw new Error("solana-market-required");
  if (!/^0x[0-9a-fA-F]{64}$/.test(market.program)
    || !/^0x[0-9a-fA-F]{64}$/.test(market.genesis)) throw new Error("solana-market-invalid");
  const wallet = await SolanaBrowserWallet.connect(market.rpcUrl, {
    network: solanaPubkeyBase58(market.genesis as `0x${string}`) === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ? "Testnet" : "Mainnet",
  });
  const program = new PublicKey(solanaPubkeyBase58(market.program as `0x${string}`));
  return new SolanaSourceLockWallet({
    rpcUrl: market.rpcUrl, wallet,
    deriveLockPda: async (lockId) => pda([encoder.encode("termbook-lock"), hexToBytes(lockId)], program).toBase58(),
    deriveRecoveryPda: async (creditId) => pda([encoder.encode("termbook-recovery"), hexToBytes(creditId)], program).toBase58(),
  }, market.genesis as `0x${string}`);
}
