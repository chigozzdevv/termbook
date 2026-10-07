import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, Transaction,
  TransactionInstruction, VersionedTransaction, type Keypair } from "@solana/web3.js";
import { Buffer } from "buffer";
import { fetchMonadAuthorizationVaa, solanaWormholeCore, type WormholeNetwork } from "./solana-wormhole.js";

import type { SolanaInstruction, SolanaWalletPort } from "./solana-source.js";

const shim = new PublicKey("EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX");
const encoder = new TextEncoder();

export type SolanaProvider = {
  publicKey?: { toBase58(): string };
  connect(): Promise<unknown>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
};

function pda(seeds: Uint8Array[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

export type SolanaSignedTransaction = { raw: Uint8Array; signature: string; blockhash: string; lastValidBlockHeight: number };
export type SolanaRpcOptions = { network?: WormholeNetwork; wormholeScanUrl?: string; authorizationAttempts?: number;
  testnetUpgradeAuthority?: string;
  sendSigned?: (transaction: SolanaSignedTransaction) => Promise<string> };
export function solanaSignature(bytes: Uint8Array): string {
  if (bytes.length !== 64) throw new Error("solana-signature-invalid");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
  let result = "";
  while (number > 0n) { result = alphabet[Number(number % 58n)] + result; number /= 58n; }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "1".repeat(zeros) + result;
}

export class SolanaRpcWallet implements SolanaWalletPort {
  readonly publicKey: string;
  readonly connection: Connection;
  readonly provider: SolanaProvider;

  constructor(provider: SolanaProvider, connection: Connection, publicKey: string, readonly options: SolanaRpcOptions = {}) {
    if (options.testnetUpgradeAuthority && (options.network !== "Testnet"
      || new PublicKey(options.testnetUpgradeAuthority).equals(PublicKey.default))) {
      throw new Error("solana-testnet-upgrade-authority-invalid");
    }
    this.provider = provider;
    this.connection = connection;
    this.publicKey = publicKey;
  }

  get wormholeNetwork(): WormholeNetwork { return this.options.network ?? "Mainnet"; }
  get testnetUpgradeAuthority(): string | undefined { return this.options.testnetUpgradeAuthority; }

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
    const raw = signed.serialize();
    const signatureBytes = signed instanceof Transaction ? signed.signature : signed.signatures[0];
    if (!signatureBytes || signatureBytes.length !== 64) throw new Error("solana-signature-invalid");
    const expected = solanaSignature(signatureBytes);
    const signature = this.options.sendSigned ? await this.options.sendSigned({ raw, signature: expected, ...latest })
      : await this.connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    if (signature !== expected) throw new Error("solana-signature-mismatch");
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
    const core = new PublicKey(solanaWormholeCore(this.wormholeNetwork));
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
    const attempts = this.options.authorizationAttempts ?? 30;
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 30) throw new Error("solana-wallet-config-invalid");
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        raw = await fetchMonadAuthorizationVaa(this.options.wormholeScanUrl ?? (this.wormholeNetwork === "Testnet" ? "https://api.testnet.wormholescan.io" : "https://api.wormholescan.io"),
          input.authorizationTxHash, input.monadCore, input.actionHash, this.wormholeNetwork);
        break;
      } catch (error) {
        if (attempt === attempts - 1 || !(error instanceof Error)
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
    const core = new PublicKey(solanaWormholeCore(this.wormholeNetwork));
    const wormhole = new SolanaWormholeCore(this.wormholeNetwork, "Solana", this.connection,
      { coreBridge: core.toBase58() });
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
