import { operationFile, readConfiguration, clearOperation } from "./testnet-state.mjs";
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { log, error } from 'node:console';
import { root, viem, artifact } from './testnet-runtime.mjs';
import { pacedHttp } from '../server/dist/chain/rpc.transport.js';
import { readCoreEvents } from '../server/dist/chain/envio.client.js';
const fast = process.argv[2] === '--fast';
const native = process.argv[2] === '--native';
const base = process.argv[2] === '--base-kuru';
const sourceChainId = native ? 10143 : base ? 84532 : 11155111;
const clean = process.argv[3] === '--clean';
if (clean && !fast || process.argv.length !== (clean ? 4 : fast || native || base ? 3 : 2)) throw new Error('Use optional --base-kuru, --native or --fast and --clean');
const publicName = base ? 'testnet-base-kuru-e2e' : native ? 'testnet-native-e2e' : fast ? clean ? 'testnet-fast-clean-e2e' : 'testnet-fast-e2e' : 'testnet-e2e';

async function main() {
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments/testnet.json'), 'utf8'));
  const recorded = JSON.parse(fs.readFileSync(operationFile(publicName), 'utf8'));
  const appSetup = readConfiguration(base ? 'kuru-integration' : 'app');
  const core = deployment.addresses[10143].TermbookCore;
  const app = base ? appSetup.definition.contracts.reader : appSetup.addresses.ReferenceAssetApp;
  if (Boolean(recorded.native) !== native || recorded.network !== 'testnet' || recorded.core !== core || recorded.app !== app
    || base && recorded.bundleId !== appSetup.bundleId) throw new Error('E2E deployment mismatch');
  const monad = viem.createPublicClient({ transport: pacedHttp('https://testnet-rpc.monad.xyz', 4) });
  const source = native ? monad : viem.createPublicClient({ transport: viem.http(base ? 'https://base-sepolia-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com') });
  if (await monad.getChainId() !== 10143 || await source.getChainId() !== sourceChainId) throw new Error('E2E network mismatch');
  const finalized = { 10143: await monad.getBlock({ blockTag: 'finalized' }),
    ...(!native ? { [sourceChainId]: await source.getBlock({ blockTag: 'finalized' }) } : {}) };
  const read = (client, name, address, functionName, args, chainId) => client.readContract({ address, abi: artifact(name).abi, functionName, args, blockNumber: finalized[chainId].number });
  const checked = new Map();
  const safeBase = base && recorded.confirmationPolicy === 'Base safe-block test policy';
  async function verifySourceProof(hash, creditId, applied = false, actionHash) {
    const tx = await monad.getTransaction({ hash });
    const decoded = viem.decodeFunctionData({ abi: artifact('TermbookCore').abi, data: tx.input });
    if (tx.to?.toLowerCase() !== core.toLowerCase() || decoded.functionName !== (applied ? 'confirmRemoteReturn' : 'proveCollateral')
      || decoded.args[0] !== creditId || !applied && decoded.args[1] !== BigInt(sourceChainId)) throw new Error('Source proof call mismatch');
    const raw = viem.hexToBytes(decoded.args[applied ? 1 : 2]);
    const start = 6 + raw[5] * 66;
    if (raw[0] !== 1 || !raw[5] || raw.length !== start + 51 + (base && !safeBase ? 128 : 160)) throw new Error('Source VAA framing mismatch');
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const publisher = deployment.addresses[sourceChainId].WormholeEthereumPublisher;
    if (view.getUint16(start + 8, false) !== (base ? 10004 : 10002) || raw[start + 50] !== (base ? safeBase ? 201 : 0 : 203)
      || viem.bytesToHex(raw.slice(start + 10, start + 42)).toLowerCase() !== viem.padHex(publisher, { size: 32 }).toLowerCase()) throw new Error('Source VAA emitter or consistency mismatch');
    if (base && !safeBase) {
      const [domain, kind, digest, deadline] = viem.decodeAbiParameters(viem.parseAbiParameters('bytes32,uint8,bytes32,uint256'), viem.bytesToHex(raw.slice(start + 51)));
      if (domain !== viem.keccak256(viem.stringToHex('Termbook Wormhole Ethereum snapshot v1'))
        || kind !== (applied ? 2 : 1) || deadline !== 0n || applied && digest !== actionHash) throw new Error('Base VAA snapshot mismatch');
      return { consistency: 0, sourceChain: sourceChainId, sequence: String(view.getBigUint64(start + 42, false)),
        publishedAt: new Date(view.getUint32(start, false) * 1000).toISOString() };
    }
    const [domain, kind, digest, deadline, policyHash] = viem.decodeAbiParameters(viem.parseAbiParameters('bytes32,uint8,bytes32,uint256,bytes32'), viem.bytesToHex(raw.slice(start + 51)));
    const policy = readConfiguration(safeBase ? 'confirmations-84532' : 'confirmations');
    if (domain !== viem.keccak256(viem.stringToHex('Termbook Wormhole Ethereum snapshot v1'))
      || kind !== (applied ? 2 : 1) || deadline !== 0n || policyHash !== policy.policyHash
      || applied && digest !== actionHash || policy.confirmationDepth !== (safeBase ? 0 : 5)
      || safeBase && (policy.sourceChain !== 84532 || policy.consistency !== 201 || policy.finality !== 'safe')) throw new Error('Fast VAA confirmation policy mismatch');
    return { consistency: safeBase ? 201 : 203, confirmationDepth: policy.confirmationDepth, policyHash, sequence: String(view.getBigUint64(start + 42, false)),
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
    let l1Fee = 0n, operatorFee = 0n;
    if (chainId === 84532) {
      const raw = await client.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (raw.blockHash !== r.blockHash || raw.transactionHash !== hash
        || !/^0x[0-9a-fA-F]+$/.test(raw.l1Fee ?? '')) throw new Error('Base fee receipt mismatch');
      l1Fee = BigInt(raw.l1Fee);
      operatorFee = await client.readContract({ address: '0x420000000000000000000000000000000000000F',
        abi: viem.parseAbi(['function getOperatorFee(uint256) view returns(uint256)']),
        functionName: 'getOperatorFee', args: [r.gasUsed], blockNumber: r.blockNumber });
    }
    const result = { chainId, hash, from: tx.from, to: tx.to, block: String(r.blockNumber), blockHash: r.blockHash,
      timestamp: Number(b.timestamp), minedAt: new Date(Number(b.timestamp) * 1000).toISOString(),
      finalized: r.blockNumber <= finalized[chainId].number, gasUsed: String(r.gasUsed), effectiveGasPrice: String(r.effectiveGasPrice),
      ...(chainId === 84532 ? { l1FeeWei: String(l1Fee), operatorFeeWei: String(operatorFee) } : {}),
      feeWei: String(r.gasUsed * r.effectiveGasPrice + l1Fee + operatorFee) };
    checked.set(key, result);
    return result;
  }
  const observations = [];
  for (const t of recorded.observations) {
    const c = await read(monad, 'TermbookCore', core, 'creditDetails', [t.creditId], 10143);
    if (await read(monad, 'TermbookCore', core, 'collateralSourceChainOf', [t.creditId], 10143) !== BigInt(sourceChainId)) throw new Error('Collateral source chain mismatch');
    const lock = await read(source, native ? 'NativeCollateralVault' : 'CollateralVault', native ? deployment.addresses[10143].NativeCollateralVault
      : deployment.addresses[sourceChainId].CollateralVault, 'locks', [t.lockId], sourceChainId);
    const position = base ? await read(monad, 'UseCaseReader', app, 'positionCount', [t.creditId, t.account], 10143)
      : await read(monad, 'ReferenceAssetApp', recorded.app, 'positions', [t.account], 10143);
    const pending = base ? await read(monad, 'UseCaseReader', app, 'pendingCount', [t.creditId, t.account], 10143) : 0n;
    const accountReleased = await read(monad, 'CreditAccount', t.account, 'released', [], 10143);
    const outcome = { kind: t.kind, creditId: t.creditId, facility: c.facility, payment: c.payment, debt: String(c.debt),
      collateralReturned: c.collateralReturned, sourceLockedAmount: String(lock[2]), appPosition: String(position), accountReleased,
      repaymentComplete: t.kind === 'repayment' && c.facility === 6 && c.payment === 4 && c.debt === 0n && c.collateralReturned && lock[2] === 0n && position === 0n && pending === 0n && accountReleased,
      recoveryComplete: t.kind.startsWith('default') && c.facility === 10 && c.debt === 0n && c.collateralReturned && lock[2] === 0n && position === 0n && pending === 0n && accountReleased,
      unusedComplete: !t.drawVerified && [6, 7].includes(c.facility) && c.debt === 0n && c.collateralReturned
        && lock[2] === 0n && position === 0n && pending === 0n && (c.facility === 7 || accountReleased),
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
      const expectedDraw = BigInt(t.drawVerified?.debt ?? recorded.drawAmount ?? '1000000');
      if (drawn.length !== 1 || drawn[0].args.amount !== expectedDraw || drawn[0].args.debt !== expectedDraw) throw new Error('Live draw event mismatch');
      outcome.drawReceipt = await receipt(10143, draw.hash);
    }
    if ((outcome.repaymentComplete || outcome.recoveryComplete) && !draw) throw new Error('Completed test has no live draw');
    for (const endpoint of native ? [] : ['collateral', 'collateral/actions']) {
      const response = await globalThis.fetch(`http://127.0.0.1:3002/${endpoint}?creditId=${t.creditId}`);
      if (!response.ok) throw new Error('Local E2E receipt index unavailable');
      const records = await response.json();
      if (!Array.isArray(records)) throw new Error('Invalid E2E receipt index');
      for (const record of records) {
        if (record.creditId !== t.creditId) throw new Error('E2E indexed credit mismatch');
        if (record.txHash) {
          const tx = await receipt(endpoint === 'collateral' ? 10143 : sourceChainId, record.txHash);
          outcome.proofAndReturnReceipts.push(tx);
          if (endpoint === 'collateral') {
            outcome.collateralProofReceipt = tx;
            if (fast || base) outcome.collateralProofPolicy = await verifySourceProof(record.txHash, t.creditId);
          }
          else outcome.sourceReturnReceipt = tx;
        }
        if (record.confirmTxHash) {
          outcome.returnConfirmationReceipt = await receipt(10143, record.confirmTxHash);
          if (fast || base) outcome.returnProofPolicy = await verifySourceProof(record.confirmTxHash, t.creditId, true, record.actionHash);
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
      let expectedRecovery, beforeDefault = 0n;
      for (let from = BigInt(accept.block); from <= finalized[10143].number;) {
        const batch = await readCoreEvents(monad, from, finalized[10143].number, 'json');
        if (batch.nextBlock <= from) throw new Error('Recovery event index has not reached the finalized block');
        const logs = batch.logs.filter((log) => topics.includes(log.topics[0]) && log.topics[1]?.toLowerCase() === t.creditId.toLowerCase());
        for (const step of logs) {
          const decoded = viem.decodeEventLog({ abi: events, topics: step.topics, data: step.data });
          if (decoded.args.creditId !== t.creditId) throw new Error('Recovery event credit mismatch');
          const tx = await receipt(10143, step.transactionHash);
          if (tx.block !== String(step.blockNumber) || tx.blockHash !== step.blockHash) throw new Error('Recovery event block mismatch');
          const mined = await monad.getTransactionReceipt({ hash: step.transactionHash });
          if (!mined.logs.some((entry) => entry.logIndex === step.logIndex
            && entry.address.toLowerCase() === core.toLowerCase() && entry.data === step.data && JSON.stringify(entry.topics) === JSON.stringify(step.topics))) throw new Error('Recovery event receipt mismatch');
          if (expectedRecovery === undefined && decoded.eventName !== 'LiquidationStarted') {
            if (decoded.eventName !== 'Repaid' || tx.timestamp >= Number(c.maturity)) throw new Error('Recovery event before liquidation');
            beforeDefault += decoded.args.amount;
            continue;
          }
          if (decoded.eventName === 'LiquidationStarted') {
            if (expectedRecovery !== undefined) throw new Error('Duplicate liquidation event');
            expectedRecovery = await monad.readContract({ address: core, abi: artifact('TermbookCore').abi,
              functionName: 'creditDebt', args: [t.creditId], blockNumber: step.blockNumber });
          }
          const approved = await monad.readContract({ address: core, abi: artifact('TermbookCore').abi,
            functionName: 'recoveryKeepers', args: [tx.from], blockNumber: step.blockNumber });
          if (!approved || tx.from.toLowerCase() === c.borrower.toLowerCase()) throw new Error('Forced recovery authority mismatch');
          if (decoded.eventName === 'AppRecoveryStep') {
            const targets = base ? appSetup.definition.assessment.recovery.map((step) => step.target.toLowerCase()) : [recorded.app.toLowerCase()];
            if (!targets.includes(decoded.args.target.toLowerCase())) throw new Error('Forced exit target mismatch');
            exited = true;
          }
          if (decoded.eventName === 'RecoveryPayment' || decoded.eventName === 'Repaid') recovered += decoded.args.amount;
          steps.push(tx);
        }
        from = batch.nextBlock;
      }
      if (!exited || expectedRecovery === undefined || expectedRecovery <= 0n || recovered !== expectedRecovery
        || expectedRecovery + beforeDefault !== BigInt(t.drawVerified?.debt ?? recorded.drawAmount ?? '1000000')) {
        throw new Error('Independent keeper did not exit and recover the full outstanding loan');
      }
      outcome.forcedRecoveryReceipts = steps;
      outcome.forcedRecoveryAmount = String(recovered);
      outcome.beforeDefaultRepaid = String(beforeDefault);
    }
    const ownReceipt = async (name) => {
      const tx = recorded.transactions.find((entry) => entry.name === `${t.kind}:${name}`);
      return tx ? receipt(tx.chainId, tx.hash) : undefined;
    };
    const accept = await ownReceipt('accept');
    const locked = await ownReceipt(native ? 'lock-MON' : 'lock-WETH');
    const repaid = await ownReceipt(base ? 'repay-cash' : 'repay');
    const authorized = await ownReceipt('authorize-return');
    const closed = await ownReceipt(t.kind === 'repayment' ? 'finish-close' : 'release-account');
    const lockProof = native ? await ownReceipt('bind-lock') : outcome.collateralProofReceipt;
    const applied = native ? authorized : outcome.sourceReturnReceipt;
    const confirmation = native ? authorized : outcome.returnConfirmationReceipt;
    if (native) {
      if (!locked || !lockProof || !authorized || !closed) throw new Error('Native custody receipts missing');
      const vault = deployment.addresses[10143].NativeCollateralVault;
      const asset = await read(monad, 'NativeCollateralVault', vault, 'asset', [], 10143);
      if (c.collateralVault.toLowerCase() !== vault.toLowerCase() || c.collateralAsset.toLowerCase() !== asset.toLowerCase()
        || await read(monad, 'TermbookCore', core, 'collateralSourceChainOf', [t.creditId], 10143) !== 10143n) throw new Error('Native collateral binding mismatch');
      const lockedReceipt = await monad.getTransactionReceipt({ hash: locked.hash });
      const returnedReceipt = await monad.getTransactionReceipt({ hash: authorized.hash });
      const events = artifact('NativeCollateralVault').abi;
      const decoded = (r) => r.logs.filter((e) => e.address.toLowerCase() === deployment.addresses[10143].NativeCollateralVault.toLowerCase())
        .map((e) => viem.decodeEventLog({ abi: events, topics: e.topics, data: e.data }));
      const locks = decoded(lockedReceipt).filter((e) => e.eventName === 'Locked' && e.args.lockId === t.lockId && e.args.creditId === t.creditId);
      const releases = decoded(returnedReceipt).filter((e) => e.eventName === 'Released' && e.args.lockId === t.lockId);
      const transaction = await monad.getTransaction({ hash: locked.hash });
      if (transaction.from.toLowerCase() !== c.borrower.toLowerCase() || transaction.value !== viem.parseEther('2')
        || locks.length !== 1 || locks[0].args.owner.toLowerCase() !== c.borrower.toLowerCase()
        || locks[0].args.amount !== viem.parseEther('2') || releases.length !== 1
        || releases[0].args.amount !== locks[0].args.amount || releases[0].args.recipient.toLowerCase() !== c.returnRecipient.toLowerCase()) throw new Error('Native custody amount or recipient mismatch');
    }
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
  const unusedFacilitiesReturned = observations.every((t) => t.drawReceipt || t.unusedComplete);
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
    lifecycleComplete, unusedFacilitiesReturned, allReceiptsFinalized,
    completed: lifecycleComplete && unusedFacilitiesReturned && allReceiptsFinalized };
  if (report.completed) { clearOperation(publicName); clearOperation(base ? "base-kuru-e2e" : native ? "native-e2e" : fast ? clean ? "fast-clean-e2e" : "fast-e2e" : "live-e2e"); }
  log(JSON.stringify({ verifiedAt: report.verifiedAt, completed: report.completed, observations }));
  if (!report.completed) process.exitCode = 1;
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split('\n')[0] : 'E2E verification failed'); process.exitCode = 1; });
