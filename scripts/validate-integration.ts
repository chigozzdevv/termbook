import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { acceptanceCases, integrationSuiteContextSchema, type AcceptanceCaseId, type IntegrationSuite } from '@termbook/schema';
import { IntegrationValidationRunner, integrationForkReview, type ValidationCheckpoint } from '../packages/sdk/src/integration/validation.js';
import type { Wallet } from '../packages/sdk/src/types/client.types.js';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node --import tsx scripts/validate-integration.ts config.json');
const config = JSON.parse(await readFile(resolve(configPath), 'utf8')) as {
  rpcUrl: string; suite: ValidationCheckpoint['suite']; module: string; parameters?: unknown;
  gasLimit: string; checkpoint: string; output: string; timeoutMs?: number;
};
const suite = integrationSuiteContextSchema.parse(config.suite);
const base = dirname(resolve(configPath));
const checkpointPath = resolve(base, config.checkpoint), outputPath = resolve(base, config.output);
if (checkpointPath === outputPath) throw new Error('integration-output-conflict');
const atomic = async (path: string, data: unknown) => {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, path);
};
const chain = defineChain({ id: suite.chainId, name: 'Integration validation', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 30_000 }) });
const wallets: Wallet[] = Object.entries(suite.actors).map(([role, expected]) => {
  const key = process.env[`TERMBOOK_VALIDATION_${role.toUpperCase()}_KEY`];
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error(`integration-${role}-wallet-required`);
  const account = privateKeyToAccount(key as Hex);
  if (account.address.toLowerCase() !== expected.toLowerCase()) throw new Error(`integration-${role}-wallet-mismatch`);
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  return { address: account.address, getChainId: () => wallet.getChainId(), signTypedData: (data) => account.signTypedData(data as never),
    writeContract: (request) => wallet.writeContract(request as never) };
});
let checkpoint: ValidationCheckpoint | undefined;
try { checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as ValidationCheckpoint; }
catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
const stop = new AbortController();
process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
const recorder = new IntegrationValidationRunner(client as never, suite, wallets, { gasLimit: BigInt(config.gasLimit),
  checkpoint, timeoutMs: config.timeoutMs, signal: stop.signal, onProgress: (state) => atomic(checkpointPath, state) });
const plugin = await import(pathToFileURL(resolve(base, config.module)).href) as {
  createScenarios: (parameters: unknown, actors: IntegrationSuite['actors']) => Promise<{
    cases: Partial<Record<AcceptanceCaseId, (runner: IntegrationValidationRunner) => Promise<void>>>;
    exclusions: IntegrationSuite['exclusions'];
  }>;
};
const scenarios = await plugin.createScenarios(config.parameters, suite.actors);
const ids = Object.keys(acceptanceCases) as AcceptanceCaseId[];
if (Object.keys(scenarios.cases).some((id) => !ids.includes(id as AcceptanceCaseId))
  || ids.some((id) => Boolean(scenarios.cases[id]) === scenarios.exclusions.some((item) => item.id === id))) throw new Error('integration-scenarios-incomplete');
for (const id of ids) {
  const scenario = scenarios.cases[id];
  if (scenario) { await recorder.run(id, scenario); process.stdout.write(`${id}: passed\n`); }
}
const report = recorder.finish(scenarios.exclusions);
await atomic(outputPath, { ...report, forkReview: suite.mode === 'fork' ? integrationForkReview(report.suite) : undefined });
process.stdout.write(`Acceptance report saved: ${outputPath}\n`);
