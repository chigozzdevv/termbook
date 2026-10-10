import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseError, encodeAbiParameters, keccak256, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { integrationSuiteSchema } from '@termbook/schema';
import { env } from '../../src/config/env.js';
import { authService } from '../../src/auth/auth.service.js';
import { assertSuiteEnvelope, forkReviewData, requireForkReview, suiteHash, validateIntegrationSuite } from '../../src/integration/integration.suite.js';
import { sampleSuite, suiteAddress, suiteWord } from './suite.fixture.js';
const initial = { core: env.core, monadChainId: env.monadChainId };
const actions = [{ capability: 'place_order', label: 'Trade', target: suiteAddress('8'),
  signature: 'function act()', arguments: [], settlement: 'atomic' as const }];
const report = () => sampleSuite();
const check = (suite = report()) => assertSuiteEnvelope(suite.versionId as `0x${string}`, suite.manifestHash as `0x${string}`, suite, suiteHash(suite), actions);
function chain(overrides: { result?: `0x${string}`; code?: `0x${string}`; blockHash?: `0x${string}` } = {}) {
  const suite = report();
  return { getChainId: vi.fn(async () => 143), getBlock: vi.fn(async () => ({ number: 1n, hash: overrides.blockHash ?? suite.sourceBlock.hash,
    transactions: [], gasLimit: 20_000_000n })), getBytecode: vi.fn(async () => overrides.code ?? '0x1234'),
    call: vi.fn(async (args: { data: string; account: string }) => {
      if (args.data === suite.cases[0]!.observations[0]!.data) return { data: overrides.result ?? encodeAbiParameters([{ type: 'uint256' }], [1n]) };
      if (args.account === suite.actors.unauthorized) throw Object.assign(new BaseError('execution reverted'), { data: '0x12345678' });
      return { data: '0x' };
    }),
  };
}
beforeEach(() => { env.core = suiteAddress('1'); env.monadChainId = 143; });
afterEach(() => { Object.assign(env, initial); vi.restoreAllMocks(); });
describe('integration acceptance report', () => {
  it('requires all applicable requirements and asserted state before and after', () => {
    const suite = report(); expect(check(suite)).toEqual(suite);
    suite.cases.pop(); expect(integrationSuiteSchema.safeParse(suite).success).toBe(false);
    const missing = report(); missing.cases[0]!.assertions = [{ label: 'meaningless assertion', left: { value: '1' }, operator: 'eq', right: { value: '1' } }];
    expect(integrationSuiteSchema.safeParse(missing).success).toBe(false);
  });
  it('requires positive controls for rejection cases', () => {
    const suite = report(); suite.cases.find((item) => item.id === 'replay')!.simulations[1]!.control = undefined;
    expect(integrationSuiteSchema.safeParse(suite).success).toBe(false);
    const noRejection = report(); noRejection.cases.find((item) => item.id === 'replay')!.simulations.pop();
    expect(integrationSuiteSchema.safeParse(noRejection).success).toBe(false);
  });
  it('allows declared fork helpers without letting them replace Core or live contract pins', async () => {
    const suite = report(); suite.mode = 'fork'; suite.forkRpcIdentity = suiteWord('f');
    const helper = { target: suiteAddress('0'), codeHash: keccak256('0xabcd'), fixture: true as const };
    suite.contracts.push(helper);
    const client = chain();
    await expect(validateIntegrationSuite(client as unknown as PublicClient, suite.versionId as `0x${string}`, suite.manifestHash as `0x${string}`, suite, suiteHash(suite), actions)).resolves.toEqual(suite);
    expect(client.getBytecode).not.toHaveBeenCalledWith(expect.objectContaining({ address: helper.target }));
    suite.contracts.find((pin) => pin.target === suite.core)!.fixture = true;
    expect(integrationSuiteSchema.safeParse(suite).success).toBe(false);
    suite.contracts.find((pin) => pin.target === suite.core)!.fixture = undefined;
    suite.mode = 'deployment'; suite.forkRpcIdentity = undefined;
    expect(integrationSuiteSchema.safeParse(suite).success).toBe(false);
  });
  it('binds the evidence hash, actors, state assertions and exclusions', () => {
    const suite = report();
    expect(() => assertSuiteEnvelope(suite.versionId as `0x${string}`, suite.manifestHash as `0x${string}`, suite, suiteWord('f'), actions)).toThrow('integration-suite-binding-invalid');
    suite.cases[0]!.observations[1]!.result = encodeAbiParameters([{ type: 'uint256' }], [2n]);
    expect(() => check(suite)).toThrow('integration-assertion-failed');
    const excluded = report(); excluded.cases = excluded.cases.filter((item) => item.id !== 'portfolio_limit'); excluded.exclusions.push({ id: 'portfolio_limit', reason: 'We would prefer to skip this failure case.' });
    expect(() => check(excluded)).toThrow('integration-suite-exclusion-invalid');
  });
  it('replays deployment reads and simulations against canonical blocks', async () => {
    const suite = report(), client = chain();
    await expect(validateIntegrationSuite(client as unknown as PublicClient, suite.versionId as `0x${string}`, suite.manifestHash as `0x${string}`, suite, suiteHash(suite), actions)).resolves.toEqual(suite);
    expect(client.call).toHaveBeenCalledTimes(suite.cases.reduce((n, item) => n + item.observations.length + item.simulations.length, 0));
    expect(client.getBlock).toHaveBeenCalledTimes(3);
  });
  it('rejects changed code, a reorg, or fabricated return data', async () => {
    const suite = report();
    for (const [overrides, message] of [[{ code: '0xabcd' }, 'integration-suite-code-changed'], [{ blockHash: suiteWord('e') }, 'integration-suite-source-invalid'],
      [{ result: encodeAbiParameters([{ type: 'uint256' }], [2n]) }, 'integration-observation-mismatch']] as const) {
      await expect(validateIntegrationSuite(chain(overrides) as unknown as PublicClient, suite.versionId as `0x${string}`, suite.manifestHash as `0x${string}`, suite, suiteHash(suite), actions)).rejects.toThrow(message);
    }
  });
  it('requires a distinct signed review for a fork report', async () => {
    const suite = report(); suite.mode = 'fork'; suite.forkRpcIdentity = keccak256('0x1234');
    const reviewer = privateKeyToAccount(suiteWord('1'));
    vi.spyOn(authService, 'isAdmin').mockImplementation((wallet) => wallet.toLowerCase() === reviewer.address.toLowerCase());
    await expect(requireForkReview(suite)).rejects.toThrow('integration-fork-review-required');
    const signature = await reviewer.signTypedData(forkReviewData(suite));
    await expect(requireForkReview(suite, signature, reviewer.address)).resolves.toBeUndefined();
    suite.manifestHash = suiteWord('f');
    await expect(requireForkReview(suite, signature, reviewer.address)).rejects.toThrow('integration-fork-review-invalid');
  });
  it('rejects a gas limit that differs from the mined transaction', async () => {
    const suite = report(), client = chain(), hash = suiteWord('e');
    const tx = { hash, from: suite.actors.borrower, to: suite.core, data: suite.cases[0]!.simulations[0]!.data,
      value: '0', succeeded: true, block: suite.sourceBlock, gasUsed: '30000', gasLimit: '30000' };
    suite.cases[0]!.transactions.push(tx);
    client.getBlock.mockResolvedValue({ number: 1n, hash: suite.sourceBlock.hash, transactions: [hash] as never[], gasLimit: 20_000_000n });
    const rpc = { ...client, getTransaction: vi.fn(async () => ({ from: tx.from, to: tx.to, input: tx.data, value: 0n, gas: 100_000n })),
      getTransactionReceipt: vi.fn(async () => ({ blockNumber: 1n, blockHash: suite.sourceBlock.hash,
        transactionIndex: 0, status: 'success', gasUsed: 30_000n })) };
    await expect(validateIntegrationSuite(rpc as unknown as PublicClient, suite.versionId as `0x${string}`,
      suite.manifestHash as `0x${string}`, suite, suiteHash(suite), actions)).rejects.toThrow('integration-transaction-evidence-mismatch');
  });
});
