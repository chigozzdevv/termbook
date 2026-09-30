import { afterEach, expect, it, vi } from "vitest";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { SolanaBrowserWallet } from "../src/collateral/solana-browser.js";
import { SOLANA_WORMHOLE_CORE, SOLANA_TESTNET_WORMHOLE_CORE } from "../src/collateral/solana-wormhole.js";
import { solanaSignature } from "../src/collateral/solana-rpc.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("derives devnet snapshot accounts from the devnet bridge", async () => {
  const owner = Keypair.generate();
  vi.stubGlobal("solana", { publicKey: owner.publicKey, connect: vi.fn(async () => undefined),
    signTransaction: vi.fn(async (transaction: Transaction) => transaction) });
  const wallet = await SolanaBrowserWallet.connect("https://api.devnet.solana.com", { network: "Testnet" });
  const metas = await wallet.prepareWormholeSnapshot(Keypair.generate().publicKey.toBase58());
  const core = new PublicKey(SOLANA_TESTNET_WORMHOLE_CORE);
  expect(metas[8]?.pubkey).toBe(core.toBase58());
  expect(metas[1]?.pubkey).toBe(PublicKey.findProgramAddressSync([new TextEncoder().encode("Bridge")], core)[0].toBase58());
});

it("connects the Solana wallet and prepares Wormhole snapshot accounts", async () => {
  const owner = Keypair.generate();
  vi.stubGlobal("solana", {
    publicKey: owner.publicKey,
    connect: vi.fn(async () => undefined),
    signTransaction: vi.fn(async (transaction: Transaction) => transaction),
  });
  const wallet = await SolanaBrowserWallet.connect("https://api.mainnet-beta.solana.com");
  const program = Keypair.generate().publicKey;
  const metas = await wallet.prepareWormholeSnapshot(program.toBase58());
  const emitter = PublicKey.findProgramAddressSync([new TextEncoder().encode("emitter")], program)[0];
  expect(wallet.publicKey).toBe(owner.publicKey.toBase58());
  expect(metas).toHaveLength(11);
  expect(metas[0]).toEqual({ pubkey: owner.publicKey.toBase58(), isSigner: true, isWritable: true });
  expect(metas[3]?.pubkey).toBe(emitter.toBase58());
  expect(metas[8]?.pubkey).toBe(SOLANA_WORMHOLE_CORE);
  expect(metas[10]?.pubkey).toBe("EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX");
});

it("serializes, signs, and finalizes a source instruction", async () => {
  const owner = Keypair.generate();
  vi.stubGlobal("solana", {
    publicKey: owner.publicKey,
    connect: vi.fn(async () => undefined),
    signTransaction: vi.fn(async (transaction: Transaction) => {
      transaction.partialSign(owner);
      return transaction;
    }),
  });
  vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100,
  });
  const sent = vi.spyOn(Connection.prototype, "sendRawTransaction")
    .mockImplementation(async (raw) => solanaSignature(Transaction.from(raw).signature!));
  vi.spyOn(Connection.prototype, "confirmTransaction").mockResolvedValue({
    context: { slot: 1 }, value: { err: null },
  });
  const wallet = await SolanaBrowserWallet.connect("https://api.mainnet-beta.solana.com");
  const programId = Keypair.generate().publicKey.toBase58();
  await wallet.sendInstruction({ programId, keys: [{ pubkey: owner.publicKey.toBase58(),
    isSigner: true, isWritable: true }], data: new Uint8Array([7]) });
  const transaction = Transaction.from(sent.mock.calls[0]![0]);
  expect(transaction.instructions[0]?.programId.toBase58()).toBe(programId);
  expect(transaction.instructions[0]?.data).toEqual(Buffer.from([7]));
});
