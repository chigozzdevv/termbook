import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { acceptanceCases, integrationSuiteContextSchema, type AcceptanceCaseId, type IntegrationSuite } from '@termbook/schema';
import { IntegrationValidationRunner, integrationForkReview, create_evidence_environment, create_sdk, package_integration,
  type ValidationCheckpoint, type Wallet, type RecordedValidation, type plugin as Plugin } from '@termbook/sdk';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node --import tsx server/scripts/integrations/validate.ts config.json');
const admit = process.argv[3] === '--admit', approve = process.argv[4] === '--approve';
if (process.argv.length !== (approve ? 5 : admit ? 4 : 3) || approve && !admit) throw new Error('Use config.json, optionally with --admit and --approve');
const config = JSON.parse(await readFile(resolve(configPath), 'utf8')) as {
  rpcUrl: string; forkRpcUrl?: string; suite: ValidationCheckpoint['suite']; module: string; parameters?: unknown;
  gasLimit: string; checkpoint: string; output: string; timeoutMs?: number;
  admission?: { applicationId: string; apiBase: string; module: string; factory: string; parameters: Record<string, unknown>;
    amount: string; lifecycle: string; tokenEnv: string };
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
if (config.forkRpcUrl) {
  const url = new URL(config.forkRpcUrl);
  if (suite.mode !== 'fork' || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('integration-fork-client-invalid');
}
const forkClient = config.forkRpcUrl ? createPublicClient({ chain, transport: http(config.forkRpcUrl, { timeout: 60_000 }) }) : undefined;
const wallets: Wallet[] = Object.entries(suite.actors).filter(([role]) => !admit || role === 'borrower').map(([role, expected]) => {
  const key = process.env[`TERMBOOK_VALIDATION_${role.toUpperCase()}_KEY`];
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error(`integration-${role}-wallet-required`);
  const account = privateKeyToAccount(key as Hex);
  if (account.address.toLowerCase() !== expected.toLowerCase()) throw new Error(`integration-${role}-wallet-mismatch`);
  const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
  return { address: account.address, getChainId: () => wallet.getChainId(), signTypedData: (data) => account.signTypedData(data as never),
    signMessage: (message) => account.signMessage({ message }), signDigest: (digest) => account.signMessage({ message: { raw: digest } }),
    writeContract: (request) => wallet.writeContract({ ...request, account } as never) };
});
if (admit) {
  const admission = config.admission;
  if (!admission || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(admission.factory)
    || !/^TERMBOOK_[A-Z_]+_APP_TOKEN$/.test(admission.tokenEnv)
    || !/^\d{1,78}$/.test(admission.amount) || BigInt(admission.amount) <= 0n) throw new Error('integration-admission-config-invalid');
  const module = await import(pathToFileURL(resolve(base, admission.module)).href) as Record<string, unknown>;
  const factory = module[admission.factory];
  if (typeof factory !== 'function') throw new Error('integration-plugin-factory-required');
  const plugin = await (factory as (options: Record<string, unknown>) => Promise<Plugin>)({ ...admission.parameters, client });
  const identity = package_integration(plugin);
  const report = JSON.parse(await readFile(outputPath, 'utf8')) as { suite: RecordedValidation['suite']; evidenceHash: string;
    admission?: { id: string; version_id: string; package_hash: string } };
  const live = JSON.parse(await readFile(resolve(base, admission.lifecycle), 'utf8')) as Pick<RecordedValidation, 'lifecycle' | 'probes'>;
  if (!live.lifecycle || !Array.isArray(live.probes)) throw new Error('integration-live-evidence-required');
  const evidence: RecordedValidation = { ...report, lifecycle: live.lifecycle, probes: live.probes.map((probe) => ({ ...probe,
    minimum_receive: probe.minimum_receive === undefined ? undefined : BigInt(probe.minimum_receive),
    maximum_spend: probe.maximum_spend === undefined ? undefined : BigInt(probe.maximum_spend),
    price_bound: probe.price_bound === undefined ? undefined : BigInt(probe.price_bound) })) };
  const wallet = wallets.find((wallet) => wallet.address.toLowerCase() === suite.actors.borrower.toLowerCase())!;
  const sdk = create_sdk({ application_id: admission.applicationId, wallet, api_base: admission.apiBase,
    validation_environment: create_evidence_environment({ client, fork_client: forkClient, evidence, options: { gasLimit: BigInt(config.gasLimit), timeoutMs: config.timeoutMs } }) });
  if (report.admission && (report.admission.version_id !== identity.version_id || report.admission.package_hash !== identity.hash)) {
    throw new Error('integration-validation-binding-invalid');
  }
  if (!report.admission) {
    const validation = await sdk.integrations.validate({ plugin, wallet, amount: BigInt(admission.amount) });
    if (!validation.passed) throw new Error(`integration-validation-failed:${validation.failures.join(',')}`);
    report.admission = validation; await atomic(outputPath, report);
  }
  let registration = await sdk.integrations.register({ validation_id: report.admission.id });
  if (registration.version_id !== identity.version_id) throw new Error('integration-registration-binding-invalid');
  if (approve && registration.status === 'awaiting_approval') {
    const reviewed = { ...report.suite, cases: (Object.keys(acceptanceCases) as AcceptanceCaseId[])
      .flatMap((id) => report.suite.cases.filter((item) => item.id === id)) };
    registration = await sdk.integrations.approve({ validation_id: report.admission.id,
      fork_review_signature: report.suite.mode === 'fork' ? await wallet.signTypedData(integrationForkReview(reviewed)) : undefined });
  }
  if (registration.status === 'active') {
    const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
    const env = await readFile(envPath, 'utf8').catch((error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    });
    const updated = env.replace(new RegExp(`^${admission.tokenEnv}=.*\\n?`, 'm'), '');
    const temporary = `${envPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${updated}${updated.endsWith('\n') || updated === '' ? '' : '\n'}${admission.tokenEnv}=${registration.app_token}\n`, { mode: 0o600 });
    await rename(temporary, envPath);
  }
  process.stdout.write(`${JSON.stringify({ integration_id: registration.integration_id, version_id: registration.version_id,
    status: registration.status, token_saved: registration.status === 'active' })}\n`);
  process.exit(0);
}
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
