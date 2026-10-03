import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { log, error } from 'node:console';
import { root, viem, artifact, writeJsonAtomic } from './testnet-runtime.mjs';
import { pacedHttp } from '../server/dist/chain/rpc.transport.js';

async function main() {
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments/testnet.json'), 'utf8'));
  const recorded = JSON.parse(fs.readFileSync(path.join(root, 'deployments/testnet-e2e.json'), 'utf8'));
  const appSetup = JSON.parse(fs.readFileSync(path.join(root, 'deployments/testnet-app.json'), 'utf8'));
  const core = deployment.addresses[10143].TermbookCore;
  if (recorded.network !== 'testnet' || recorded.core !== core || recorded.app !== appSetup.addresses.ReferenceAssetApp) throw new Error('E2E deployment mismatch');
  const monad = viem.createPublicClient({ transport: pacedHttp('https://testnet-rpc.monad.xyz', 4) });
  const source = viem.createPublicClient({ transport: viem.http('https://ethereum-sepolia-rpc.publicnode.com') });
  if (await monad.getChainId() !== 10143 || await source.getChainId() !== 11155111) throw new Error('E2E network mismatch');
  const finalized = { 10143: await monad.getBlock({ blockTag: 'finalized' }), 11155111: await source.getBlock({ blockTag: 'finalized' }) };
  const read = (client, name, address, functionName, args, chainId) => client.readContract({ address, abi: artifact(name).abi, functionName, args, blockNumber: finalized[chainId].number });
  const checked = new Map();
  async function receipt(chainId, hash) {
    const key = `${chainId}:${hash}`;
    if (checked.has(key)) return checked.get(key);
    const client = chainId === 10143 ? monad : source;
    const r = await client.getTransactionReceipt({ hash });
    const b = await client.getBlock({ blockNumber: r.blockNumber });
    if (r.status !== 'success' || b.hash !== r.blockHash || b.transactions[r.transactionIndex] !== hash) throw new Error('E2E receipt is reverted or noncanonical');
    const tx = await client.getTransaction({ hash });
    const result = { chainId, hash, from: tx.from, to: tx.to, block: String(r.blockNumber), blockHash: r.blockHash,
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
    const outcome = { kind: t.kind, creditId: t.creditId, facility: c.facility, payment: c.payment, debt: String(c.debt),
      collateralReturned: c.collateralReturned, sourceLockedAmount: String(lock[2]), appPosition: String(position),
      repaymentComplete: t.kind === 'repayment' && c.facility === 6 && c.payment === 4 && c.debt === 0n && c.collateralReturned && lock[2] === 0n && position === 0n,
      recoveryComplete: t.kind.startsWith('default') && c.facility === 10 && c.debt === 0n && c.collateralReturned && lock[2] === 0n && position === 0n,
      setupAborted: c.facility === 7, proofAndReturnReceipts: [] };
    for (const endpoint of ['collateral', 'collateral/actions']) {
      const response = await globalThis.fetch(`http://127.0.0.1:3002/${endpoint}?creditId=${t.creditId}`);
      if (!response.ok) throw new Error('Local E2E receipt index unavailable');
      const records = await response.json();
      if (!Array.isArray(records)) throw new Error('Invalid E2E receipt index');
      for (const record of records) {
        if (record.creditId !== t.creditId) throw new Error('E2E indexed credit mismatch');
        if (record.txHash) outcome.proofAndReturnReceipts.push(await receipt(endpoint === 'collateral' ? 10143 : 11155111, record.txHash));
        if (record.confirmTxHash) outcome.proofAndReturnReceipts.push(await receipt(10143, record.confirmTxHash));
      }
    }
    if (outcome.recoveryComplete) {
      const accept = recorded.transactions.find((tx) => tx.name === `${t.kind}:accept`);
      if (!accept) throw new Error('Default acceptance receipt missing');
      const steps = [];
      const event = artifact('TermbookCore').abi.find((e) => e.type === 'event' && e.name === 'AppRecoveryStep');
      for (let from = BigInt(accept.block); from <= finalized[10143].number; from += 100n) {
        const to = from + 99n > finalized[10143].number ? finalized[10143].number : from + 99n;
        for (const step of await monad.getLogs({ address: core, event, args: { creditId: t.creditId }, fromBlock: from, toBlock: to })) {
          const tx = await receipt(10143, step.transactionHash);
          const approved = await monad.readContract({ address: core, abi: artifact('TermbookCore').abi,
            functionName: 'recoveryKeepers', args: [tx.from], blockNumber: step.blockNumber });
          if (!approved || tx.from.toLowerCase() === c.borrower.toLowerCase() || step.args.target.toLowerCase() !== recorded.app.toLowerCase()) throw new Error('Forced recovery authority mismatch');
          steps.push(tx);
        }
      }
      if (steps.length === 0) throw new Error('No independent keeper recovery was executed');
      outcome.forcedRecoveryReceipts = steps;
    }
    observations.push(outcome);
  }
  for (const tx of recorded.transactions) await receipt(tx.chainId, tx.hash);
  const fees = {};
  for (const tx of checked.values()) fees[tx.chainId] = (BigInt(fees[tx.chainId] ?? '0') + BigInt(tx.feeWei)).toString();
  const report = { verifiedAt: new Date().toISOString(), core, scope: recorded.scope, excluded: recorded.excluded,
    finalizedBlocks: Object.fromEntries(Object.entries(finalized).map(([id, b]) => [id, { number: String(b.number), hash: b.hash }])),
    observations, measuredFeesWei: fees, transactions: [...checked.values()],
    completed: observations.some((t) => t.repaymentComplete) && observations.some((t) => t.recoveryComplete) };
  writeJsonAtomic(path.join(root, 'deployments/testnet-e2e-verification.json'), report);
  log(JSON.stringify({ verifiedAt: report.verifiedAt, completed: report.completed, observations }));
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split('\n')[0] : 'E2E verification failed'); process.exitCode = 1; });
