import { afterEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";
import { Connection, Keypair, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";
import { SolanaBrowserWallet } from "../src/collateral/solana-browser.js";
import { solanaPaymentWallet, verifySolanaPayment } from "../src/settlement/solana-payment.js";
import { solanaPubkeyBytes } from "../src/collateral/solana.js";
import { solanaSignature } from "../src/collateral/solana-rpc.js";
import type { PaymentRoute } from "../src/settlement/payment-types.js";
import type { SettlementRegistration } from "../src/settlement/settlement.js";
const height = vi.hoisted(() => vi.fn(async () => 98));
vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  class TestConnection extends actual.Connection {
    constructor(...args: ConstructorParameters<typeof actual.Connection>) { super(...args); this.getBlockHeight = height; }
  }
  return { ...actual, Connection: TestConnection };
});
const payer = Keypair.generate(), destination = Keypair.generate().publicKey;
const genesis = Keypair.generate().publicKey.toBase58(), blockhash = Keypair.generate().publicKey.toBase58();
const route = { sourceKind: "native", sourceAddressFormat: "solana", sourceRpcUrl: "https://sol.example",
  sourceGenesis: solanaPubkeyBytes(genesis) } as PaymentRoute;
const registration = { depositAddress: destination.toBase58(), amountIn: 100n } as SettlementRegistration;
function fixture() {
  vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(genesis);
  vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({ blockhash, lastValidBlockHeight: 99 });
  vi.spyOn(SolanaBrowserWallet, "connect").mockResolvedValue({ publicKey: payer.publicKey.toBase58(),
    provider: { publicKey: payer.publicKey, signTransaction: async (tx: Transaction) => { tx.sign(payer); return tx; } } } as never);
}
afterEach(() => vi.restoreAllMocks());
describe("Solana payment durability", () => {
  it("saves signed transfer bytes before broadcast and resumes the same signed transaction", async () => {
    fixture();
    let submission: { raw: string; blockhash: string; lastValidBlockHeight: number } | undefined;
    const broadcast = vi.spyOn(Connection.prototype, "sendRawTransaction").mockImplementation(async (raw) => {
      expect(submission).toBeDefined(); const tx = Transaction.from(raw); return solanaSignature(tx.signature!);
    });
    const wallet = await solanaPaymentWallet(route);
    const signature = await wallet.fund(registration, route, async (_hash, saved) => { submission = saved; });
    const signed = Transaction.from(Buffer.from(submission!.raw, "base64"));
    expect(SystemInstruction.decodeTransfer(signed.instructions[0]!).lamports).toBe(100n);
    vi.spyOn(Connection.prototype, "getParsedTransaction").mockResolvedValue(null);
    vi.spyOn(Connection.prototype, "getSignatureStatuses").mockResolvedValue({ context: { slot: 1 }, value: [null] });
    height.mockResolvedValue(98);
    expect(await verifySolanaPayment(route, registration, signature, payer.publicKey.toBase58(), submission)).toBe(false);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[0]![0]).toEqual(broadcast.mock.calls[1]![0]);
  });
  it("rejects a wallet that changes the payment payload before broadcast", async () => {
    fixture();
    vi.spyOn(SolanaBrowserWallet, "connect").mockResolvedValue({ publicKey: payer.publicKey.toBase58(),
      provider: { publicKey: payer.publicKey, signTransaction: async (tx: Transaction) => {
        tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 100n }));
        tx.sign(payer); return tx;
      } } } as never);
    const send = vi.spyOn(Connection.prototype, "sendRawTransaction");
    const wallet = await solanaPaymentWallet(route);
    await expect(wallet.fund(registration, route, vi.fn())).rejects.toThrow("solana-wallet-payload-changed");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects a different source genesis before connecting a wallet", async () => {
    fixture(); const connect = vi.mocked(SolanaBrowserWallet.connect);
    vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(Keypair.generate().publicKey.toBase58());
    await expect(solanaPaymentWallet(route)).rejects.toThrow("source-chain-mismatch");
    expect(connect).not.toHaveBeenCalled();
  });
});
