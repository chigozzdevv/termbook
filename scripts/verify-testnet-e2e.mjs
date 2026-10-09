import { operationFile, readConfiguration, clearOperation } from "./testnet-state.mjs";
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { log, error } from 'node:console';
import { root, viem, artifact } from './testnet-runtime.mjs';
import { pacedHttp } from '../server/dist/chain/rpc.transport.js';
const fast = process.argv[2] === '--fast';
const clean = process.argv[3] === '--clean';
if (clean && !fast || process.argv.length !== (clean ? 4 : fast ? 3 : 2)) throw new Error('Use optional --fast and --clean');
const publicName = fast ? clean ? 'testnet-fast-clean-e2e' : 'testnet-fast-e2e' : 'testnet-e2e';

async function main() {
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments/testnet.json'), 'utf8'));
  const recorded = JSON.parse(fs.readFileSync(operationFile(publicName), 'utf8'));
  const appSetup = readConfiguration('app');
  const core = deployment.addresses[10143].TermbookCore;
  if (recorded.network !== 'testnet' || recorded.core !== core || recorded.app !== appSetup.addresses.ReferenceAssetApp) throw new Error('E2E deployment mismatch');
  const monad = viem.createPublicClient({ transport: pacedHttp('https://testnet-rpc.monad.xyz', 4) });
  const source = viem.createPublicClient({ transport: viem.http('https://ethereum-sepolia-rpc.publicnode.com') });
  if (await monad.getChainId() !== 10143 || await source.getChainId() !== 11155111) throw new Error('E2E network mismatch');
  const finalized = { 10143: await monad.getBlock({ blockTag: 'finalized' }), 11155111: await source.getBlock({ blockTag: 'finalized' }) };
  const read = (client, name, address, functionName, args, chainId) => client.readContract({ address, abi: artifact(name).abi, functionName, args, blockNumber: finalized[chainId].number });
  const checked = new Map();
  async function verifyFastProof(hash, creditId, applied = false, actionHash) {
    const tx = await monad.getTransaction({ hash });
    const decoded = viem.decodeFunctionData({ abi: artifact('TermbookCore').abi, data: tx.input });
    if (tx.to?.toLowerCase() !== core.toLowerCase() || decoded.functionName !== (applied ? 'confirmRemoteReturn' : 'proveCollateral')
      || decoded.args[0] !== creditId || !applied && decoded.args[1] !== 11155111n) throw new Error('Fast proof call mismatch');
    const raw = viem.hexToBytes(decoded.args[applied ? 1 : 2]);
    const start = 6 + raw[5] * 66;
    if (raw[0] !== 1 || !raw[5] || raw.length !== start + 51 + 160) throw new Error('Fast VAA framing mismatch');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const publisher = deployment.addresses[11155111].WormholeEthereumPublisher;
    if (view.getUint16(start + 8, false) !== 10002 || raw[start + 50] !== 203
      || viem.bytesToHex(raw.slice(start + 10, start + 42)).toLowerCase() !== viem.padHex(publisher, { size: 32 }).toLowerCase()) throw new Error('Fast VAA emitter or consistency mismatch');
    const [domain, kind, digest, deadline, policyHash] = viem.decodeAbiParameters(viem.parseAbiParameters('bytes32,uint8,bytes32,uint256,bytes32'), viem.bytesToHex(raw.slice(start + 51)));
    const policy = readConfiguration('confirmations');
    if (domain !== viem.keccak256(viem.stringToHex('Termbook Wormhole Ethereum snapshot v1'))
      || kind !== (applied ? 2 : 1) || deadline !== 0n || policyHash !== policy.policyHash
      || applied && digest !== actionHash || policy.confirmationDepth !== 5) throw new Error('Fast VAA confirmation policy mismatch');
    return { consistency: 203, confirmationDepth: 5, policyHash, sequence: String(view.getBigUint64(start + 42, false)),
      publishedAt: new Date(view.getUint32(start, false) * 1000).toISOString() };
  }
  async function receipt(chainId, hash) {
    const key = `${chainId}:${hash}`;
    if (checked.has(key)) return checked.get(key);
    const client = chainId === 10143 ? monad : source;
    const r = await client.getTransactionReceipt({ hash });
    const b = await client.getBlock({ blockNumber: r.blockNumber });
    if (r.status !== 'success' || b.hash !== r.blockHash || b.transactions[r.transactionIndex] !== hash) throw new Error('E2E receipt is reverted or noncanonical');
    const tx = await client.getTransaction({ hash });
    const result = { chainId, hash, from: tx.from, to: tx.to, block: String(r.blockNumber), blockHash: r.blockHash,
      timestamp: Number(b.timestamp), minedAt: new Date(Number(b.timestamp) * 1000).toISOString(),
      finalized: r.blockNumber <= finalized[chainId].number, gasUsed: String(r.gasUsed), effectiveGasPrice: String(r.effectiveGasPrice),
      feeWei: String(r.gasUsed * r.effectiveGasPrice) };
    checked.set(key, result);
    return result;
  }
  const observations = [];
  for (const t of recorded.observations) {
    const c = await read(monad, 'TermbookCore', core, 'creditDetails', [t.creditId], 10143);
    const lock = await read(source, 'CollateralVault', deployment.addresses[11155111].CollateralVault, 'locks', [t.lockId], 11155111);
    const position = await read(monad, 'ReferenceAssetApp', recorded.app, 'positions', [t.account], 10143);
    const accountReleased = await read(monad, 'CreditAccount', t.account, 'released', [], 10143);
    const outcome = { kind: t.kind, creditId: t.creditId, facility: c.facility, payment: c.payment, debt: String(c.debt),
      collateralReturned: c.collateralReturned, sourceLockedAmount: String(lock[2]), appPosition: String(position), accountReleased,
      repaymentComplete: t.kind === 'repayment' && c.facility === 6 && c.payment === 4 && c.debt === 0n && c.collateralReturned && lock[2] === 0n && position === 0n && accountReleased,
      recoveryComplete: t.kind.startsWith('default') && c.facility === 10 && c.debt === 0n && c.collateralReturned && lock[2] === 0n && position === 0n && accountReleased,
      setupAborted: c.facility === 7, proofAndReturnReceipts: [],
      observedCompletedAt: t.completedAt };
    const draw = recorded.transactions.find((tx) => tx.name === `${t.kind}:borrow-and-deposit`);
    if (draw) {
      const drawReceipt = await monad.getTransactionReceipt({ hash: draw.hash });
      const events = drawReceipt.logs.filter((entry) => entry.address.toLowerCase() === core.toLowerCase()).flatMap((entry) => {
        try { return [viem.decodeEventLog({ abi: artifact('TermbookCore').abi, topics: entry.topics, data: entry.data })]; }
        catch { return []; }
      });
      const drawn = events.filter((entry) => entry.eventName === 'Drawn' && entry.args.creditId === t.creditId);
      if (drawn.length !== 1 || drawn[0].args.amount !== 1_000_000n || drawn[0].args.debt !== 1_000_000n) throw new Error('Live draw event mismatch');
      outcome.drawReceipt = await receipt(10143, draw.hash);
    }
    if ((outcome.repaymentComplete || outcome.recoveryComplete) && !draw) throw new Error('Completed test has no live draw');
    for (const endpoint of ['collateral', 'collateral/actions']) {
      const response = await globalThis.fetch(`http://127.0.0.1:3002/${endpoint}?creditId=${t.creditId}`);
      if (!response.ok) throw new Error('Local E2E receipt index unavailable');
      const records = await response.json();
      if (!Array.isArray(records)) throw new Error('Invalid E2E receipt index');
      for (const record of records) {
        if (record.creditId !== t.creditId) throw new Error('E2E indexed credit mismatch');
        if (record.txHash) {
          const tx = await receipt(endpoint === 'collateral' ? 10143 : 11155111, record.txHash);
          outcome.proofAndReturnReceipts.push(tx);
          if (endpoint === 'collateral') {
            outcome.collateralProofReceipt = tx;
            if (fast) outcome.collateralProofPolicy = await verifyFastProof(record.txHash, t.creditId);
          }
          else outcome.sourceReturnReceipt = tx;
        }
        if (record.confirmTxHash) {
          outcome.returnConfirmationReceipt = await receipt(10143, record.confirmTxHash);
          if (fast) outcome.returnProofPolicy = await verifyFastProof(record.confirmTxHash, t.creditId, true, record.actionHash);
          outcome.proofAndReturnReceipts.push(outcome.returnConfirmationReceipt);
        }
      }
    }
    if (outcome.recoveryComplete || t.kind.startsWith('default') && [8, 9].includes(c.facility) && c.debt === 0n) {
      const accept = recorded.transactions.find((tx) => tx.name === `${t.kind}:accept`);
      if (!accept) throw new Error('Default acceptance receipt missing');
      const steps = [];
      const events = artifact('TermbookCore').abi.filter((e) => e.type === 'event' && ['AppRecoveryStep', 'RecoveryPayment', 'Repaid', 'LiquidationStarted'].includes(e.name));
      const topics = events.map((event) => viem.encodeEventTopics({ abi: [event], eventName: event.name })[0]);
      let exited = false;
      let recovered = 0n;
      for (let from = BigInt(accept.block); from <= finalized[10143].number; from += 100n) {
        const to = from + 99n > finalized[10143].number ? finalized[10143].number : from + 99n;
        const logs = await monad.request({ method: 'eth_getLogs', params: [{ address: core, fromBlock: viem.toHex(from), toBlock: viem.toHex(to), topics: [topics, t.creditId] }] });
        for (const step of logs) {
          const decoded = viem.decodeEventLog({ abi: events, topics: step.topics, data: step.data });
          if (decoded.args.creditId !== t.creditId) throw new Error('Recovery event credit mismatch');
          const tx = await receipt(10143, step.transactionHash);
          if (tx.block !== String(viem.hexToBigInt(step.blockNumber)) || tx.blockHash !== step.blockHash) throw new Error('Recovery event block mismatch');
          const mined = await monad.getTransactionReceipt({ hash: step.transactionHash });
          if (!mined.logs.some((entry) => entry.logIndex === Number(viem.hexToBigInt(step.logIndex))
            && entry.address.toLowerCase() === core.toLowerCase() && entry.data === step.data && JSON.stringify(entry.topics) === JSON.stringify(step.topics))) throw new Error('Recovery event receipt mismatch');
          const approved = await monad.readContract({ address: core, abi: artifact('TermbookCore').abi,
            functionName: 'recoveryKeepers', args: [tx.from], blockNumber: viem.hexToBigInt(step.blockNumber) });
          if (!approved || tx.from.toLowerCase() === c.borrower.toLowerCase()) throw new Error('Forced recovery authority mismatch');
          if (decoded.eventName === 'AppRecoveryStep') {
            if (decoded.args.target.toLowerCase() !== recorded.app.toLowerCase()) throw new Error('Forced exit target mismatch');
            exited = true;
          }
          if (decoded.eventName === 'RecoveryPayment' || decoded.eventName === 'Repaid') recovered += decoded.args.amount;
          steps.push(tx);
        }
      }
      if (!exited || recovered !== 1_000_000n) throw new Error('Independent keeper did not exit and recover the full loan');
      outcome.forcedRecoveryReceipts = steps;
      outcome.forcedRecoveryAmount = String(recovered);
    }
    const ownReceipt = async (name) => {
      const tx = recorded.transactions.find((entry) => entry.name === `${t.kind}:${name}`);
      return tx ? receipt(tx.chainId, tx.hash) : undefined;
    };
    const accept = await ownReceipt('accept');
    const locked = await ownReceipt('lock-WETH');
    const repaid = await ownReceipt('repay');
    const authorized = await ownReceipt('authorize-return');
    const closed = await ownReceipt(t.kind === 'repayment' ? 'finish-close' : 'release-account');
    const lockProof = outcome.collateralProofReceipt;
    const applied = outcome.sourceReturnReceipt;
    const confirmation = outcome.returnConfirmationReceipt;
    const recovery = outcome.forcedRecoveryReceipts ?? [];
    const recoveryTimes = [...new Set(recovery.map((tx) => tx.timestamp))].sort((a, b) => a - b);
    const elapsed = (start, end) => start && end ? end.timestamp - start.timestamp : null;
    outcome.timings = {
      basis: 'Canonical block timestamps; includes keeper polling and cross-chain finality waits',
      setupSeconds: elapsed(accept, locked),
      collateralProofSeconds: elapsed(locked, lockProof),
      proofToBorrowSeconds: elapsed(lockProof, outcome.drawReceipt),
      borrowToRepaymentSeconds: elapsed(outcome.drawReceipt, repaid),
      defaultEligibleAt: t.kind.startsWith('default') ? new Date(Number(c.maturity + c.grace) * 1000).toISOString() : null,
      defaultWaitSeconds: t.kind.startsWith('default') && outcome.drawReceipt ? Number(c.maturity + c.grace) - outcome.drawReceipt.timestamp : null,
      defaultDetectionSeconds: recoveryTimes.length ? recoveryTimes[0] - Number(c.maturity + c.grace) : null,
      forcedRecoverySeconds: recoveryTimes.length ? recoveryTimes.at(-1) - recoveryTimes[0] : null,
      returnAuthorizationToSourceSeconds: elapsed(authorized, applied),
      returnConfirmationSeconds: elapsed(applied, confirmation),
      closureSeconds: elapsed(confirmation, closed),
      acceptToClosureSeconds: elapsed(accept, closed),
    };
    observations.push(outcome);
  }
  for (const tx of recorded.transactions) await receipt(tx.chainId, tx.hash);
  const fees = {};
  for (const tx of checked.values()) fees[tx.chainId] = (BigInt(fees[tx.chainId] ?? '0') + BigInt(tx.feeWei)).toString();
  const lifecycleComplete = observations.some((t) => t.repaymentComplete) && (fast || observations.some((t) => t.recoveryComplete));
  const allReceiptsFinalized = [...checked.values()].every((tx) => tx.finalized);
  const house = { address: deployment.addresses[10143].HouseVault };
  for (const name of ['manager', 'freeCash', 'availableCash', 'committedCash', 'drawnPrincipal', 'activeCreditCount', 'totalAssets', 'totalShares']) {
    const value = await read(monad, 'HouseVault', house.address, name, [], 10143);
    house[name] = typeof value === 'bigint' ? value.toString() : value;
  }
  const report = { verifiedAt: new Date().toISOString(), startedAt: recorded.startedAt, core, scope: recorded.scope, excluded: recorded.excluded,
    confirmationPolicy: recorded.confirmationPolicy,
    feeScope: 'Listed borrower, proof, return and recovery receipts; excludes keeper funding and oracle updates',
    finalizedBlocks: Object.fromEntries(Object.entries(finalized).map(([id, b]) => [id, { number: String(b.number), hash: b.hash }])),
    house, observations, measuredFeesWei: fees, transactions: [...checked.values()],
    lifecycleComplete, allReceiptsFinalized, completed: lifecycleComplete && allReceiptsFinalized };
  if (report.completed) { clearOperation(publicName); clearOperation(fast ? clean ? "fast-clean-e2e" : "fast-e2e" : "live-e2e"); }
  log(JSON.stringify({ verifiedAt: report.verifiedAt, completed: report.completed, observations }));
  if (!report.completed) process.exitCode = 1;
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split('\n')[0] : 'E2E verification failed'); process.exitCode = 1; });
