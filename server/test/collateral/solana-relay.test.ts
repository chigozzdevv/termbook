import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import { solanaSignature } from "@termbook/sdk";
import { deliverSolanaRelay, sendSolanaRelay } from "../../src/collateral/solana-relay.transaction.js";
import { solanaRelayRepo, type RelayTransaction } from "../../src/collateral/solana-relay.repo.js";

vi.mock("../../src/collateral/solana-relay.repo.js", () => ({ solanaRelayRepo: {
  prepared: vi.fn(), renew: vi.fn(), transactionResult: vi.fn(),
} }));
const signer = Keypair.fromSeed(new Uint8Array(32).fill(1));
const destination = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const actionHash = `0x${"1".repeat(64)}`;
function fixture() {
  const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: destination.toBase58() })
    .add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: destination, lamports: 10 }));
  transaction.sign(signer);
  const tx = { raw: transaction.serialize(), signature: solanaSignature(transaction.signature!),
    blockhash: destination.toBase58(), lastValidBlockHeight: 100 };
  const saved: RelayTransaction = { _id: tx.signature, actionHash, raw: Buffer.from(tx.raw).toString("base64"),
    blockhash: tx.blockhash, lastValidBlockHeight: 100, status: "prepared" };
  const getSignatureStatuses = vi.fn(async () => ({ value: [null] as unknown[] }));
  const sendRawTransaction = vi.fn(async () => tx.signature);
  const getBlockHeight = vi.fn(async () => 99);
  const confirmTransaction = vi.fn(async () => ({ value: { err: null } }));
  const connection = { getSignatureStatuses, sendRawTransaction, getBlockHeight, confirmTransaction } as unknown as Connection;
  return { tx, saved, connection, getSignatureStatuses, sendRawTransaction, getBlockHeight, confirmTransaction };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(solanaRelayRepo.renew).mockResolvedValue(true); });
describe("durable Solana source transactions", () => {
  it("never broadcasts before persistence and a valid renewed lease", async () => {
    const f = fixture();
    vi.mocked(solanaRelayRepo.prepared).mockRejectedValueOnce(new Error("database-unavailable"));
    await expect(sendSolanaRelay(f.connection, actionHash, "lease", f.tx, 64)).rejects.toThrow("database-unavailable");
    expect(f.sendRawTransaction).not.toHaveBeenCalled();
    vi.mocked(solanaRelayRepo.renew).mockResolvedValue(false);
    await expect(sendSolanaRelay(f.connection, actionHash, "lease", f.tx, 64)).rejects.toThrow("solana-relay-lease-lost");
    expect(f.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("reconciles a finalized broadcast after a crash without sending it again", async () => {
    const f = fixture();
    f.getSignatureStatuses.mockResolvedValue({ value: [{ confirmationStatus: "finalized", err: null, slot: 42 }] });
    expect(await deliverSolanaRelay(f.connection, f.saved)).toBe("success");
    expect(f.sendRawTransaction).not.toHaveBeenCalled();
    expect(solanaRelayRepo.transactionResult).toHaveBeenCalledWith(f.tx.signature, "success", 42);
  });
  it("retains custody accounting until finality and retries the exact signed bytes", async () => {
    const f = fixture();
    expect(await deliverSolanaRelay(f.connection, f.saved)).toBe("pending");
    expect(f.sendRawTransaction).toHaveBeenCalledWith(f.tx.raw, expect.objectContaining({ skipPreflight: false }));
    expect(solanaRelayRepo.transactionResult).not.toHaveBeenCalled();
    f.getSignatureStatuses.mockResolvedValue({ value: [{ confirmationStatus: "confirmed", err: null, slot: 42 }] });
    expect(await deliverSolanaRelay(f.connection, f.saved)).toBe("pending");
    expect(f.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("retires expired blockhashes and failed finalized transactions distinctly", async () => {
    const f = fixture(); f.getBlockHeight.mockResolvedValue(101);
    expect(await deliverSolanaRelay(f.connection, f.saved)).toBe("expired");
    expect(f.sendRawTransaction).not.toHaveBeenCalled();
    f.getSignatureStatuses.mockResolvedValue({ value: [{ confirmationStatus: "finalized", err: { InstructionError: [0, 1] }, slot: 43 }] });
    expect(await deliverSolanaRelay(f.connection, f.saved)).toBe("reverted");
    expect(solanaRelayRepo.transactionResult).toHaveBeenCalledWith(f.tx.signature, "reverted", 43);
  });
  it("rejects changed journal signatures or blockhashes before any RPC call", async () => {
    const f = fixture();
    await expect(deliverSolanaRelay(f.connection, { ...f.saved, blockhash: signer.publicKey.toBase58() })).rejects.toThrow("solana-relay-transaction-invalid");
    await expect(deliverSolanaRelay(f.connection, { ...f.saved, _id: "1".repeat(88) })).rejects.toThrow("solana-relay-transaction-invalid");
    expect(f.getSignatureStatuses).not.toHaveBeenCalled();
  });
});
