import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import process from "node:process";
import { setTimeout } from "node:timers";
import { URL } from "node:url";
import { createRequire } from "node:module";
const { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY,
  TransactionInstruction, TransactionMessage, VersionedTransaction } = createRequire(new URL("../packages/sdk/package.json", import.meta.url))("@solana/web3.js");

const url = new URL(process.argv[2] ?? "http://127.0.0.1:8899");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("runtime-check-requires-local-validator");
const program = new PublicKey(process.argv[3] ?? (() => { throw new Error("program-id-required"); })());
const connection = new Connection(url.href, "confirmed");
assert.equal((await connection.getAccountInfo(program))?.executable, true, "program-not-loaded");
const payer = Keypair.generate();
const airdrop = await connection.requestAirdrop(payer.publicKey, 1_000_000_000);
let funded = false;
for (let i = 0; i < 50; ++i) {
  const status = (await connection.getSignatureStatuses([airdrop])).value[0];
  if (status?.err) throw new Error("local-airdrop-failed");
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") { funded = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(funded, true, "local-airdrop-unconfirmed");
async function simulate(data, keys = []) {
  const { blockhash } = await connection.getLatestBlockhash();
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash,
    instructions: [new TransactionInstruction({ programId: program, data, keys })] }).compileToV0Message());
  transaction.sign([payer]);
  return (await connection.simulateTransaction(transaction, { sigVerify: true })).value;
}
assert.deepEqual((await simulate(Buffer.from([255]))).err, { InstructionError: [0, "InvalidInstructionData"] });
const lockId = Buffer.alloc(32, 1), creditId = Buffer.alloc(32, 2);
const [lock] = PublicKey.findProgramAddressSync([Buffer.from("termbook-lock"), lockId], program);
const [recovery] = PublicKey.findProgramAddressSync([Buffer.from("termbook-recovery"), creditId], program);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const data = Buffer.concat([Buffer.from([0]), lockId, creditId, u64(143), Buffer.alloc(20, 3), Buffer.alloc(20, 4),
  Buffer.alloc(32, 5), payer.publicKey.toBuffer(), recovery.toBuffer(), Buffer.alloc(32, 8), u64(100_000_000),
  u64(Math.floor(Date.now() / 1000) + 3600), u64(1)]);
const result = await simulate(data, [
  { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: lock, isSigner: false, isWritable: true },
  { pubkey: recovery, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, { pubkey: program, isSigner: false, isWritable: false },
  { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
]);
assert.deepEqual(result.err, { InstructionError: [0, { Custom: 3 }] }, JSON.stringify(result.logs));
assert.equal(await connection.getAccountInfo(lock), null, "unverified-lock-created-custody");
log("Solana runtime passed: program load, instruction decoding, Clock, PDA derivation, Keccak, and rejection of an unverified lock");
