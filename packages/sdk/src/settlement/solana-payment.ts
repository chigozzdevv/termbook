import { Buffer } from "buffer";
import { Connection, PublicKey, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";
import { solanaPubkeyBytes } from "../collateral/solana.js";
import { SolanaBrowserWallet } from "../collateral/solana-browser.js";
import { solanaSignature } from "../collateral/solana-rpc.js";
import type { PaymentRoute, PaymentSourceWallet, SourcePaymentSubmission } from "./payment-types.js";
import type { SettlementRegistration } from "./settlement.js";
async function connectionFor(route: PaymentRoute) {
  if (route.sourceKind !== "native" || !route.sourceGenesis) throw new Error("solana-payment-route-invalid");
  const connection = new Connection(route.sourceRpcUrl, "finalized");
  if (solanaPubkeyBytes(await connection.getGenesisHash()) !== route.sourceGenesis) throw new Error("source-chain-mismatch");
  return connection;
}
export async function solanaPaymentWallet(route: PaymentRoute): Promise<PaymentSourceWallet> {
  const connection = await connectionFor(route);
  const wallet = await SolanaBrowserWallet.connect(route.sourceRpcUrl);
  return { address: wallet.publicKey, async fund(registration, _route, onSubmitted) {
    if (wallet.provider.publicKey?.toBase58() !== wallet.publicKey || registration.amountIn > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("source-wallet-changed");
    const latest = await connection.getLatestBlockhash("finalized");
    const tx = new Transaction({ feePayer: new PublicKey(wallet.publicKey), ...latest }).add(SystemProgram.transfer({
      fromPubkey: new PublicKey(wallet.publicKey), toPubkey: new PublicKey(registration.depositAddress),
      lamports: registration.amountIn,
    }));
    const message = tx.compileMessage().serialize();
    const signed = await wallet.provider.signTransaction(tx);
    if (!signed.compileMessage().serialize().equals(message)) throw new Error("solana-wallet-payload-changed");
    if (!signed.signature) throw new Error("solana-signature-invalid");
    const signature = solanaSignature(signed.signature);
    const raw = signed.serialize();
    await onSubmitted(signature, { raw: Buffer.from(raw).toString("base64"), ...latest });
    if (await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }) !== signature) throw new Error("solana-signature-mismatch");
    return signature;
  } };
}
export async function verifySolanaPayment(route: PaymentRoute, registration: SettlementRegistration,
  signature: string, sender: string, submission?: SourcePaymentSubmission): Promise<boolean> {
  const connection = await connectionFor(route);
  const tx = await connection.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!tx) {
    if (submission) {
      const raw = Buffer.from(submission.raw, "base64"), signed = Transaction.from(raw);
      const instruction = signed.instructions[0];
      if (raw.length > 1232 || !signed.signature || solanaSignature(signed.signature) !== signature
        || signed.recentBlockhash !== submission.blockhash || signed.feePayer?.toBase58() !== sender
        || signed.instructions.length !== 1 || !instruction || !instruction.programId.equals(SystemProgram.programId)
        || !Number.isSafeInteger(submission.lastValidBlockHeight)) throw new Error("source-transfer-invalid");
      const transfer = SystemInstruction.decodeTransfer(instruction);
      if (transfer.fromPubkey.toBase58() !== sender || transfer.toPubkey.toBase58() !== registration.depositAddress
        || transfer.lamports !== registration.amountIn) throw new Error("source-transfer-invalid");
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (!status && await connection.getBlockHeight("finalized") > submission.lastValidBlockHeight
        && !(await connection.isBlockhashValid(submission.blockhash, { commitment: "finalized" })).value) throw new Error("source-transfer-expired");
      if (!status) await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    }
    return false;
  }
  if (!tx.meta || tx.meta.err || tx.transaction.signatures[0] !== signature) throw new Error("source-transfer-invalid");
  const payer = tx.transaction.message.accountKeys[0];
  const transfers = tx.transaction.message.instructions.filter((instruction) => "parsed" in instruction
    && instruction.programId.equals(SystemProgram.programId) && instruction.parsed?.type === "transfer");
  if (!payer?.signer || payer.pubkey.toBase58() !== sender || transfers.length !== 1 || tx.transaction.message.instructions.length !== 1) throw new Error("source-transfer-invalid");
  const transfer = transfers[0]!;
  if (!("parsed" in transfer)) throw new Error("source-transfer-invalid");
  const info = transfer.parsed.info;
  if (info.source !== sender || info.destination !== registration.depositAddress
    || !Number.isSafeInteger(info.lamports) || BigInt(info.lamports) !== registration.amountIn) throw new Error("source-transfer-invalid");
  return true;
}

export async function verifySolanaRefund(route: PaymentRoute, registration: SettlementRegistration,
  hashes: string[], amount: bigint): Promise<boolean> {
  const connection = await connectionFor(route);
  let returned = 0n;
  for (const hash of new Set(hashes)) {
    const tx = await connection.getParsedTransaction(hash, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    if (!tx?.meta || tx.meta.err || tx.transaction.signatures[0] !== hash) continue;
    const instructions = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((group) => group.instructions)];
    for (const instruction of instructions) {
      if (!("parsed" in instruction) || !instruction.programId.equals(SystemProgram.programId)
        || instruction.parsed?.type !== "transfer") continue;
      const info = instruction.parsed.info;
      if (info.destination === registration.sourceRefundRecipient && Number.isSafeInteger(info.lamports)) returned += BigInt(info.lamports);
    }
  }
  return returned >= amount;
}
