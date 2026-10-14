import { operationFile, readConfiguration, clearOperation } from "../testnet/state.mjs";
import fs from "node:fs";
import path from "node:path";
import { log, error } from "node:console";
import process from "node:process";
import { root, viem, artifact } from "../testnet/runtime.mjs";
import { PublicKey, solanaConnection } from "./testnet-runtime.mjs";
import { decodeSolanaLockRecord } from "../../packages/sdk/dist/index.js";
const clean = process.argv[2] === "--clean";
if (process.argv.length !== (clean ? 3 : 2)) throw new Error("Use optional --clean");

async function main() {
  const report = JSON.parse(fs.readFileSync(operationFile(clean ? "testnet-solana-clean-e2e" : "testnet-solana-e2e")));
  const setup = readConfiguration("solana");
  const deployment = JSON.parse(fs.readFileSync(path.join(root, "deployments/testnet.json")));
  const client = viem.createPublicClient({ transport: viem.http("https://testnet-rpc.monad.xyz") });
  const connection = solanaConnection();
  if (await client.getChainId() !== 10143 || await connection.getGenesisHash() !== deployment.solana.genesis
    || report.core !== deployment.addresses[10143].TermbookCore || !report.completed) throw new Error("SOL E2E network or completion mismatch");
  const finalized = await client.getBlock({ blockTag: "finalized" });
  const receipts = new Map();
  async function receipt(hash) {
    if (receipts.has(hash)) return receipts.get(hash);
    const r = await client.getTransactionReceipt({ hash });
    const block = await client.getBlock({ blockNumber: r.blockNumber });
    const tx = await client.getTransaction({ hash });
    if (r.status !== "success" || r.blockNumber > finalized.number || r.blockHash !== block.hash
      || block.transactions[r.transactionIndex] !== hash) throw new Error("SOL E2E Monad receipt mismatch");
    const result = { hash, from: tx.from, to: tx.to, block: String(r.blockNumber), blockHash: block.hash,
      timestamp: Number(block.timestamp), feeWei: String(r.gasUsed * r.effectiveGasPrice) };
    receipts.set(hash, result); return result;
  }
  const read = (name, address, functionName, args = []) => client.readContract({ address, abi: artifact(name).abi,
    functionName, args, blockNumber: finalized.number });
  const credit = await read("TermbookCore", report.core, "creditDetails", [report.creditId]);
  const pda = new PublicKey(viem.hexToBytes(report.lockPda));
  const lock = await connection.getAccountInfo(pda, "finalized");
  const record = decodeSolanaLockRecord(lock.data);
  if (credit.facility !== 6 || credit.debt !== 0n || !credit.collateralReturned || !lock.owner.equals(new PublicKey(deployment.solana.programId))
    || record.remainingAmount !== 0n || record.initialAmount !== BigInt(report.collateralLamports)
    || record.creditId !== report.creditId || record.lockId !== report.lockId || record.lastActionHash !== report.returnActionHash
    || await read("ReferenceAssetApp", report.app, "positions", [report.account]) !== 0n
    || !await read("CreditAccount", report.account, "released")) throw new Error("SOL E2E final state mismatch");
  for (const entry of report.transactions) await receipt(entry.hash);
  const draw = report.transactions.find((entry) => entry.name === "borrow-and-deposit");
  const drawn = (await client.getTransactionReceipt({ hash: draw.hash })).logs.flatMap((entry) => {
    if (entry.address.toLowerCase() !== report.core.toLowerCase()) return [];
    try { return [viem.decodeEventLog({ abi: artifact("TermbookCore").abi, topics: entry.topics, data: entry.data })]; } catch { return []; }
  }).filter((event) => event.eventName === "Drawn" && event.args.creditId === report.creditId);
  if (drawn.length !== 1 || drawn[0].args.amount !== BigInt(report.drawAmount) || drawn[0].args.debt !== BigInt(report.drawAmount)) throw new Error("SOL live draw event mismatch");
  const response = await globalThis.fetch(`http://127.0.0.1:3002/collateral/solana?creditId=${report.creditId}`);
  if (!response.ok) throw new Error("SOL proof index unavailable");
  const proofs = (await response.json()).filter((entry) => entry.lockId === report.lockId && entry.state === "proven" && entry.txHash);
  if (proofs.length !== 1) throw new Error("SOL proof receipt missing");
  const proofReceipt = await receipt(proofs[0].txHash);
  const sourceReceipts = new Map();
  async function sourceReceipt(signature) {
    if (sourceReceipts.has(signature)) return sourceReceipts.get(signature);
    const tx = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (!tx || tx.meta?.err || !status || status.err || status.confirmationStatus !== "finalized" || status.slot !== tx.slot) throw new Error("SOL receipt mismatch");
    const result = { signature, slot: tx.slot, timestamp: tx.blockTime, feeLamports: tx.meta.fee,
      payer: tx.transaction.message.staticAccountKeys[0].toBase58() };
    sourceReceipts.set(signature, result); return result;
  }
  for (const tx of report.solanaTransactions) await sourceReceipt(tx.signature);
  const history = await connection.getSignaturesForAddress(pda, { limit: 30 }, "finalized");
  let returned;
  for (const entry of history) {
    if (entry.err) continue;
    const tx = await connection.getTransaction(entry.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    const message = tx.transaction.message;
    const instructions = message.compiledInstructions.filter((instruction) => message.staticAccountKeys[instruction.programIdIndex]?.toBase58() === deployment.solana.programId && instruction.data[0] === 1);
    if (!instructions.length) continue;
    const source = await sourceReceipt(entry.signature);
    const ownerIndex = message.staticAccountKeys.findIndex((key) => key.toBase58() === report.sourceOwner);
    const lockIndex = message.staticAccountKeys.findIndex((key) => key.equals(pda));
    if (instructions.length !== 1 || source.payer !== setup.keeper || source.payer === report.sourceOwner
      || ownerIndex < 0 || lockIndex < 0 || message.header.numRequiredSignatures !== 1
      || tx.meta.postBalances[ownerIndex] - tx.meta.preBalances[ownerIndex] !== Number(report.collateralLamports)
      || tx.meta.preBalances[lockIndex] - tx.meta.postBalances[lockIndex] !== Number(report.collateralLamports)) throw new Error("SOL keeper return custody mismatch");
    returned = source; break;
  }
  if (!returned) throw new Error("SOL keeper return receipt missing");
  const authorization = report.transactions.find((tx) => tx.name === "authorize-return");
  const finish = report.transactions.find((tx) => tx.name === "finish-close");
  const event = artifact("TermbookCore").abi.find((e) => e.type === "event" && e.name === "CollateralReturned");
  const returns = [];
  for (let from = BigInt(authorization.block); from <= BigInt(finish.block); from += 100n) {
    const to = from + 99n > BigInt(finish.block) ? BigInt(finish.block) : from + 99n;
    returns.push(...await client.getLogs({ address: report.core, event, args: { creditId: report.creditId }, fromBlock: from, toBlock: to }));
  }
  if (returns.length !== 1 || returns[0].args.lockId !== report.lockId || returns[0].args.amount !== BigInt(report.collateralLamports)) throw new Error("SOL return confirmation event mismatch");
  const confirmation = await receipt(returns[0].transactionHash);
  const time = (name) => receipts.get(report.transactions.find((tx) => tx.name === name).hash).timestamp;
  const locked = await sourceReceipt(report.lockTx);
  const output = { network: "testnet", checkedAt: new Date().toISOString(), creditId: report.creditId, core: report.core,
    completed: true, scope: "SOL lock, USDC draw into reference app, app exit, repayment, keeper return, confirmation and closure",
    collateralLamports: report.collateralLamports, drawAmount: report.drawAmount, drawHealth: report.drawVerified,
    timingSeconds: { acceptanceToLock: locked.timestamp - time("accept"), lockToProof: proofReceipt.timestamp - locked.timestamp,
      proofToBorrow: time("borrow-and-deposit") - proofReceipt.timestamp, acceptanceToBorrow: time("borrow-and-deposit") - time("accept"),
      borrowToRepay: time("repay") - time("borrow-and-deposit"), authorizeToSourceReturn: returned.timestamp - time("authorize-return"),
      sourceReturnToConfirmation: confirmation.timestamp - returned.timestamp, acceptanceToClosure: time("finish-close") - time("accept") },
    monadReceipts: [...receipts.values()], solanaReceipts: [...sourceReceipts.values()], proofReceipt, sourceReturnReceipt: returned, returnConfirmationReceipt: confirmation };
  clearOperation(clean ? "testnet-solana-clean-e2e" : "testnet-solana-e2e");
  clearOperation(clean ? "solana-clean-e2e" : "solana-e2e");
  log(JSON.stringify({ completed: true, timingSeconds: output.timingSeconds, monadReceipts: receipts.size, solanaReceipts: sourceReceipts.size }));
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "SOL verification failed"); process.exitCode = 1; });
