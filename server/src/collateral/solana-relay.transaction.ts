import { Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { solanaSignature, type SolanaSignedTransaction } from "@termbook/sdk";
import { solanaRelayRepo, type RelayTransaction } from "./solana-relay.repo.js";

function checked(tx: RelayTransaction): Uint8Array {
  const raw = Buffer.from(tx.raw, "base64");
  if (raw.toString("base64") !== tx.raw || raw.length > 1232) throw new Error("solana-relay-transaction-invalid");
  let signature: Uint8Array;
  let blockhash: string;
  try {
    const parsed = Transaction.from(raw);
    if (!parsed.signature || !parsed.verifySignatures()) throw new Error();
    signature = parsed.signature; blockhash = parsed.recentBlockhash!;
  } catch {
    const parsed = VersionedTransaction.deserialize(raw);
    const message = parsed.message.serialize();
    if (parsed.signatures.length !== parsed.message.header.numRequiredSignatures
      || parsed.signatures.some((value, index) => !ed25519.verify(value, message, parsed.message.staticAccountKeys[index]!.toBytes()))) {
      throw new Error("solana-relay-signature-invalid");
    }
    signature = parsed.signatures[0]!; blockhash = parsed.message.recentBlockhash;
  }
  if (solanaSignature(signature) !== tx._id || blockhash !== tx.blockhash
    || !Number.isSafeInteger(tx.lastValidBlockHeight) || tx.lastValidBlockHeight <= 0) throw new Error("solana-relay-transaction-invalid");
  return raw;
}
export async function deliverSolanaRelay(connection: Connection, tx: RelayTransaction): Promise<"success" | "reverted" | "expired" | "pending"> {
  const raw = checked(tx);
  let status = (await connection.getSignatureStatuses([tx._id], { searchTransactionHistory: true })).value[0];
  if (status?.confirmationStatus === "finalized") {
    const result = status.err ? "reverted" : "success";
    await solanaRelayRepo.transactionResult(tx._id, result, status.slot);
    return result;
  }
  if (!status && await connection.getBlockHeight("finalized") > tx.lastValidBlockHeight) {
    await solanaRelayRepo.transactionResult(tx._id, "expired");
    return "expired";
  }
  if (!status) {
    if (await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 }) !== tx._id) {
      throw new Error("solana-relay-signature-mismatch");
    }
  }
  status = (await connection.getSignatureStatuses([tx._id], { searchTransactionHistory: true })).value[0];
  if (status?.confirmationStatus !== "finalized") return "pending";
  const result = status.err ? "reverted" : "success";
  await solanaRelayRepo.transactionResult(tx._id, result, status.slot);
  return result;
}
export async function sendSolanaRelay(connection: Connection, actionHash: string, lease: string,
  tx: SolanaSignedTransaction, maxTransactions: number): Promise<string> {
  await solanaRelayRepo.prepared(actionHash, lease, tx, maxTransactions);
  if (!await solanaRelayRepo.renew(actionHash, lease)) throw new Error("solana-relay-lease-lost");
  const result = await deliverSolanaRelay(connection, { _id: tx.signature, actionHash, status: "prepared",
    raw: Buffer.from(tx.raw).toString("base64"), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight });
  if (result === "pending") {
    await connection.confirmTransaction({ signature: tx.signature, blockhash: tx.blockhash,
      lastValidBlockHeight: tx.lastValidBlockHeight }, "finalized").catch(() => null);
    const final = await deliverSolanaRelay(connection, { _id: tx.signature, actionHash, status: "prepared",
      raw: Buffer.from(tx.raw).toString("base64"), blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight });
    if (final !== "success") throw new Error(`solana-relay-transaction-${final}`);
    return tx.signature;
  }
  if (result !== "success") throw new Error(`solana-relay-transaction-${result}`);
  return tx.signature;
}
