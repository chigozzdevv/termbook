import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, Transaction,
  TransactionInstruction, VersionedTransaction, type Keypair } from "@solana/web3.js";
import { Buffer } from "buffer";
import { hexToBytes } from "viem";
import type { CollateralMarket } from "@termbook/schema";
import { SolanaSourceLockWallet, type SolanaInstruction, type SolanaWalletPort } from "./solana-source.js";
import { solanaPubkeyBase58 } from "./solana.js";
import { fetchMonadAuthorizationVaa, SOLANA_WORMHOLE_CORE } from "./solana-wormhole.js";

const shim = new PublicKey("EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX");
const core = new PublicKey(SOLANA_WORMHOLE_CORE);
const encoder = new TextEncoder();

type SolanaProvider = {
  publicKey?: { toBase58(): string };
  connect(): Promise<unknown>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
};

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

function pda(seeds: Uint8Array[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

export class SolanaBrowserWallet implements SolanaWalletPort {
  readonly publicKey: string;
  readonly connection: Connection;
  readonly provider: SolanaProvider;

  private constructor(provider: SolanaProvider, connection: Connection, publicKey: string) {
    this.provider = provider;
    this.connection = connection;
    this.publicKey = publicKey;
  }

  static async connect(rpcUrl: string): Promise<SolanaBrowserWallet> {
    const provider = injectedSolanaProvider();
    await provider.connect();
    const publicKey = provider.publicKey?.toBase58();
    if (!publicKey) throw new Error("solana-wallet-unavailable");
    new PublicKey(publicKey);
    return new SolanaBrowserWallet(provider, new Connection(rpcUrl, "finalized"), publicKey);
  }

  private async send(transaction: Transaction | VersionedTransaction, signers: Keypair[] = []): Promise<string> {
    if (this.provider.publicKey?.toBase58() !== this.publicKey) throw new Error("solana-wallet-changed");
    const latest = await this.connection.getLatestBlockhash("finalized");
    if (transaction instanceof Transaction) {
      transaction.feePayer = new PublicKey(this.publicKey);
      transaction.recentBlockhash = latest.blockhash;
      if (signers.length) transaction.partialSign(...signers);
    } else {
      transaction.message.recentBlockhash = latest.blockhash;
      if (signers.length) transaction.sign(signers);
    }
    const signed = await this.provider.signTransaction(transaction);
    const signature = await this.connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false, maxRetries: 3,
    });
    const result = await this.connection.confirmTransaction({ signature, ...latest }, "finalized");
    if (result.value.err) throw new Error("solana-transaction-failed");
    return signature;
  }

  async sendInstruction(instruction: SolanaInstruction): Promise<string> {
    const tx = new Transaction().add(new TransactionInstruction({
      programId: new PublicKey(instruction.programId),
      keys: instruction.keys.map((key) => ({
        pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable,
      })),
      data: Buffer.from(instruction.data),
    }));
    return this.send(tx);
  }

  async prepareWormholeSnapshot(programId: string): Promise<SolanaInstruction["keys"]> {
    const emitter = pda([encoder.encode("emitter")], new PublicKey(programId));
    const bridge = pda([encoder.encode("Bridge")], core);
    const message = pda([emitter.toBytes()], shim);
    const sequence = pda([encoder.encode("Sequence"), emitter.toBytes()], core);
    const collector = pda([encoder.encode("fee_collector")], core);
    const authority = pda([encoder.encode("__event_authority")], shim);
    const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) =>
      ({ pubkey: pubkey.toBase58(), isWritable, isSigner });
    return [
      meta(new PublicKey(this.publicKey), true, true), meta(bridge, true), meta(message, true),
      meta(emitter), meta(sequence, true), meta(collector, true), meta(SYSVAR_CLOCK_PUBKEY),
      meta(SystemProgram.programId), meta(core), meta(authority), meta(shim),
    ];
  }

  async prepareWormholeAuthorization(input: {
    programId: string; monadCore: `0x${string}`; actionHash: `0x${string}`;
    authorizationTxHash?: `0x${string}`;
  }) {
    if (!input.authorizationTxHash) throw new Error("solana-wormhole-authorization-unavailable");
    let raw: Uint8Array | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        raw = await fetchMonadAuthorizationVaa("https://api.wormholescan.io",
          input.authorizationTxHash, input.monadCore, input.actionHash);
        break;
      } catch (error) {
        if (attempt === 29 || !(error instanceof Error)
          || error.message !== "solana-wormhole-authorization-unavailable") throw error;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    }
    if (!raw) throw new Error("solana-wormhole-authorization-unavailable");
    const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
    scope.Buffer ??= Buffer;
    const [{ deserialize }, { SolanaWormholeCore }] = await Promise.all([
      import("@wormhole-foundation/sdk-connect"),
      import("@wormhole-foundation/sdk-solana-core"),
    ]);
    const vaa = deserialize("Uint8Array", raw);
    const wormhole = new SolanaWormholeCore("Mainnet", "Solana", this.connection,
      { coreBridge: SOLANA_WORMHOLE_CORE });
    for await (const step of wormhole.postVaa(this.publicKey, vaa)) {
      await this.send(step.transaction.transaction, step.transaction.signers);
    }
    const postedVaa = pda([encoder.encode("PostedVAA"), vaa.hash], core).toBase58();
    let finalized = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const account = await this.connection.getAccountInfo(new PublicKey(postedVaa), "finalized");
      if (account?.owner.equals(core)) {
        finalized = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!finalized) throw new Error("solana-wormhole-authorization-unavailable");
    return { postedVaa, snapshotAccounts: await this.prepareWormholeSnapshot(input.programId) };
  }
}

export async function connectSolanaBrowserSourceWallet(market: CollateralMarket) {
  if (market.kind !== "solana") throw new Error("solana-market-required");
  if (!/^0x[0-9a-fA-F]{64}$/.test(market.program)
    || !/^0x[0-9a-fA-F]{64}$/.test(market.genesis)) throw new Error("solana-market-invalid");
  const wallet = await SolanaBrowserWallet.connect(market.rpcUrl);
  const program = new PublicKey(solanaPubkeyBase58(market.program as `0x${string}`));
  return new SolanaSourceLockWallet({
    rpcUrl: market.rpcUrl, wallet,
    deriveLockPda: async (lockId) => pda([encoder.encode("termbook-lock"), hexToBytes(lockId)], program).toBase58(),
    deriveRecoveryPda: async (creditId) => pda([encoder.encode("termbook-recovery"), hexToBytes(creditId)], program).toBase58(),
  }, market.genesis as `0x${string}`);
}
