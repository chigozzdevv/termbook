import { describe, expect, it, vi } from 'vitest';
import { BaseError, encodeAbiParameters, keccak256, stringToHex, toFunctionSelector, type Hex, type PublicClient } from 'viem';
import { IntegrationValidationPendingError, IntegrationValidationRunner, integrationEvidenceHash, integrationForkReview, type ValidationCheckpoint } from '../src/integration/validation.js';
import { sampleSuite, suiteWord } from './integration-suite.fixture.js';
import { canonicalEvidence } from '@termbook/schema';
const suite = sampleSuite();
const context: ValidationCheckpoint["suite"] = { format: suite.format, core: suite.core, versionId: suite.versionId,
  manifestHash: suite.manifestHash, chainId: suite.chainId, mode: suite.mode, sourceBlock: suite.sourceBlock,
  actors: suite.actors, contracts: suite.contracts };
const tx = suiteWord('e');
function client() {
  return { getChainId: vi.fn(async () => 143), getBytecode: vi.fn(async () => '0x1234'),
    getBlock: vi.fn(async () => ({ number: 1n, hash: suite.sourceBlock.hash, transactions: [tx], gasLimit: 20_000_000n })),
    call: vi.fn(async () => ({ data: encodeAbiParameters([{ type: 'uint256' }], [1n]) })),
    getTransactionReceipt: vi.fn(async () => ({ blockNumber: 1n, blockHash: suite.sourceBlock.hash, transactionIndex: 0, status: 'success', gasUsed: 30_000n })),
    getTransaction: vi.fn(async () => ({ from: suite.actors.borrower, to: suite.core, input: toFunctionSelector('act()'), value: 0n })),
  };
}
function wallet() { return { address: suite.actors.borrower as Hex, writeContract: vi.fn(async () => tx), signTypedData: vi.fn() }; }
async function scenario(runner: IntegrationValidationRunner) {
  await runner.observe({ id: 'before', target: suite.core as Hex, from: suite.actors.borrower as Hex, signature: 'function state() view returns (uint256)', phase: 'before' });
  await runner.transact({ from: suite.actors.borrower as Hex, to: suite.core as Hex, signature: 'function act()' });
  await runner.observe({ id: 'after', target: suite.core as Hex, from: suite.actors.borrower as Hex, signature: 'function state() view returns (uint256)', phase: 'after' });
  await runner.assert({ label: 'state comparison', left: { observation: 'before', index: 0 }, operator: 'eq', right: { observation: 'after', index: 0 } });
}
describe('integration validation recorder', () => {
  it('records canonical state, transactions and bounded gas', async () => {
    const chain = client(), signer = wallet(); let saved: ValidationCheckpoint | undefined;
    const runner = new IntegrationValidationRunner(chain as unknown as PublicClient, context, [signer], { gasLimit: 1_000_000n, onProgress: (state) => { saved = state; } });
    await runner.run('bounded_calls', scenario);
    expect(saved?.cases[0]?.transactions[0]).toMatchObject({ hash: tx, succeeded: true, gasUsed: '30000' });
    expect(signer.writeContract).toHaveBeenCalledWith(expect.objectContaining({ gas: 1_000_000n }));
    expect(() => runner.finish()).toThrow();
  });
  it('resumes the same submitted transaction and preserves pre-state', async () => {
    const chain = client(), signer = wallet(), abort = new AbortController(); let checkpoint: ValidationCheckpoint | undefined;
    const runner = new IntegrationValidationRunner(chain as unknown as PublicClient, context, [signer], { gasLimit: 1_000_000n, signal: abort.signal,
      onProgress: (state) => { checkpoint = state; if (state.pending) abort.abort(); } });
    await expect(runner.run('bounded_calls', scenario)).rejects.toBeInstanceOf(IntegrationValidationPendingError);
    expect(checkpoint?.pending?.tx).toBe(tx);
    const resumed = new IntegrationValidationRunner(chain as unknown as PublicClient, context, [signer], { gasLimit: 1_000_000n, checkpoint,
      onProgress: (state) => { checkpoint = state; } });
    await resumed.run('bounded_calls', scenario);
    expect(signer.writeContract).toHaveBeenCalledTimes(1);
    expect(checkpoint?.cases[0]?.observations).toHaveLength(2);
    expect(checkpoint?.pending).toBeUndefined();
  });
  it('does not classify an RPC failure as a rejected application call', async () => {
    const chain = client(), signer = wallet(); chain.call.mockRejectedValue(new BaseError('RPC unavailable'));
    const runner = new IntegrationValidationRunner(chain as unknown as PublicClient, context, [signer], { gasLimit: 1_000_000n });
    await expect(runner.run('pause_failure', (r) => r.simulate('paused', { from: suite.actors.borrower as Hex, to: suite.core as Hex, signature: 'function act()' }).then(() => undefined))).rejects.toMatchObject({ cause: { message: expect.stringContaining('RPC unavailable') } });
  });
  it('matches the server evidence digest and typed fork review', () => {
    expect(integrationEvidenceHash(suite)).toBe(keccak256(stringToHex(canonicalEvidence(suite))));
    expect(integrationForkReview(suite).message).toMatchObject({ versionId: suite.versionId, manifestHash: suite.manifestHash, sourceBlockHash: suite.sourceBlock.hash });
  });
});
