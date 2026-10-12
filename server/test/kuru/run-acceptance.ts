import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPublicClient, http, keccak256, toHex, parseAbi, type Address, type Hex } from "viem";
import { IntegrationValidationRunner, atomic_configuration, use_case_configuration, type ValidationCheckpoint } from "@termbook/sdk";
import type { IntegrationSuite, PluginDefinition } from "@termbook/schema";
import { Fixture, word, GAS_LIMIT } from "./acceptance-fixture.js";
import { DeploymentFixture } from "./deployment-fixture.js";
import { createScenarios, kuru_acceptance_cases } from "./acceptance.js";
import { orderCases } from "./orders-acceptance.js";

async function main() {
  const rpc = process.argv[2] ?? "http://127.0.0.1:18548";
  const deployed = process.argv[3] === "--deployment";
  const focused = process.argv[4] === "--case" ? process.argv[5] : undefined;
  if (process.argv.length !== (focused ? 6 : deployed ? 4 : process.argv[2] ? 3 : 2) || focused && !deployed) {
    throw new Error("Use [local-fork-rpc], optionally with --deployment and --case case-id");
  }
  const deployment = deployed ? JSON.parse(await readFile("deployments/testnet.json", "utf8")) : undefined;
  const keeper = process.env["RISK_KEEPER_KEY"];
  const borrower = deployed ? JSON.parse(await readFile(".testnet/evm.json", "utf8")).privateKey : undefined;
  if (deployed && (!keeper || !/^0x[a-fA-F0-9]{64}$/.test(keeper))) throw new Error("validation-live-keeper-key-required");
  const fixture = deployed ? new DeploymentFixture(rpc, deployment, [borrower as Hex, keeper as Hex, toHex(0xbadn, { size: 32 })]) : new Fixture(rpc);
  const available = [...kuru_acceptance_cases, ...(fixture instanceof DeploymentFixture && fixture.orderDefinition ? orderCases : [])];
  if (focused && !available.some((id) => id === focused)) throw new Error("validation-case-unsupported");
  const caseIds = available.filter((id) => !focused || id === focused);
  await fixture.setup();
  process.stdout.write("Kuru fork fixture configured\n");
  const ids = [...caseIds, "control", "duplicate_control", "cure_control", "isolation_control", "order_control"];
  if (fixture instanceof DeploymentFixture) await fixture.warmCredits(ids);
  for (const id of ids) {
    await fixture.facility(id);
    process.stdout.write(`Prepared ${id}\n`);
  }
  const block = await fixture.chain.getBlock({ blockTag: "finalized" });
  const definition: PluginDefinition | undefined = deployment?.configuration["kuru-integration"].definition;
  const identity = definition ? (definition.assessment ? use_case_configuration : atomic_configuration)(definition) : undefined;
  const liveFile = definition?.assessment?.orders ? "testnet-kuru-orders-e2e.json" : "testnet-kuru-e2e.json";
  const loadLive = () => readFile(`.data/operations/${liveFile}`, "utf8")
    .then((value) => JSON.parse(value))
    .catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined; });
  const live = deployed ? await loadLive() : undefined;
  const journal = deployed && !live?.lifecycle ? await readFile(`.data/operations/${definition?.assessment?.orders ? "kuru-orders-e2e" : "kuru-e2e"}.json`, "utf8")
    .then((value) => JSON.parse(value)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return undefined; }) : undefined;
  if (journal && journal.bundleId !== fixture.bundle) throw new Error("validation-live-version-mismatch");
  const liveCredits: Hex[] = live?.lifecycle ? [live.lifecycle.active_credit_id, live.lifecycle.recovered_credit_id]
    : Object.values(journal?.cases ?? {}).map((item) => (item as { creditId: Hex }).creditId);
  if (liveCredits.some((id) => !/^0x[a-fA-F0-9]{64}$/.test(id))) throw new Error("validation-live-credit-invalid");
  const names = ["TermbookCore", "FlowExecutor", "ReservationManager", "PriceProtection", "RiskEngine", "HouseRegistry", "IntegrationRegistry", "OracleRegistry", "CollateralHealthReader", "AppHealthReader", "HealthSource", "AccountHealthSource", "AtomicSpotRouter", "AtomicSpotModule", "SpotOrderTracker", "UseCaseReader", "UseCasePolicy", "UseCaseRecovery", "ReadProgram", "AccountFactory", "HouseVault", "InboxFactory", "CollateralVault", "SpotAcceptanceProbe", "MockERC20", "PriceFeedFixture", "USDPriceFeedFixture", "SpotCallbackFixture", "CallbackRouter", "Circle", "Kuru"];
  const targets = [...new Set([...(deployed ? names.map((name) => fixture.addresses[name]!).filter(Boolean) : Object.values(fixture.addresses)), ...fixture.guards,
    ...[...fixture.facilities.values()].map((v) => v.account), ...(identity?.definition.pins.map((p) => p.target as Address) ?? []),
    ...(fixture instanceof DeploymentFixture ? [fixture.liveHouse, ...[...fixture.helpers].map((v) => v as Address)] : [])].map((v) => v.toLowerCase() as Address))];
  for (const id of liveCredits) {
    const account = await fixture.chain.readContract({ address: fixture.addresses.TermbookCore!, abi: parseAbi(["function creditAccount(bytes32) view returns(address)"]), functionName: "creditAccount", args: [id] });
    if (!targets.includes(account.toLowerCase() as Address)) targets.push(account.toLowerCase() as Address);
  }
  const contracts: IntegrationSuite["contracts"] = [];
  for (const target of targets) {
    const code = await fixture.chain.getBytecode({ address: target, blockNumber: block.number });
    if (!code || code === "0x") throw new Error(`validation-code-missing:${target}`);
    contracts.push({ target, codeHash: keccak256(code), ...(fixture instanceof DeploymentFixture && fixture.helpers.has(target.toLowerCase()) ? { fixture: true as const } : {}) });
  }
  const context = { format: 1 as const, versionId: fixture.bundle, manifestHash: identity?.hash ?? word("Kuru diagnostic manifest"),
    core: fixture.addresses.TermbookCore!, chainId: 10143, mode: "fork" as const, sourceBlock: { number: String(block.number), hash: block.hash },
    forkRpcIdentity: word(rpc), actors: fixture.actors, contracts,
    ...(fixture instanceof DeploymentFixture ? { sourceBlock: fixture.sourceBlock } : {}) };
  const output = join(await mkdtemp(join(tmpdir(), "termbook-kuru-acceptance-")), "report.json");
  const fork = deployed ? await fixture.rpcCall("anvil_nodeInfo") as unknown as { forkConfig: { forkUrl: string } } : undefined;
  const sourceClient = fork ? createPublicClient({ transport: http(fork.forkConfig.forkUrl, { timeout: 60_000 }) }) : undefined;
  let recorded: ValidationCheckpoint | undefined;
  const runner = new IntegrationValidationRunner(fixture.chain, context, fixture.wallets, { gasLimit: GAS_LIMIT, timeoutMs: 60 * 60_000, sourceClient,
    pollIntervalMs: 50, onProgress: async (checkpoint) => { recorded = checkpoint; await writeFile(output, JSON.stringify({ diagnostic: true, checkpoint }, null, 2)); } });
  const scenarios = await createScenarios(fixture, fixture.actors, caseIds);
  for (const id of caseIds) {
    await runner.run(id, scenarios.cases[id]!);
    process.stdout.write(`${id}: passed\n`);
  }
  if (focused) {
    const item = recorded?.cases.find((item) => item.id === focused);
    if (!item) throw new Error("validation-focused-evidence-missing");
    const replay = new IntegrationValidationRunner(fixture.chain, context, [], { gasLimit: GAS_LIMIT, timeoutMs: 60 * 60_000, sourceClient });
    await replay.run(item.id, (r) => r.replay(item));
    await writeFile(output, JSON.stringify({ diagnostic: true, reason: "focused_case", context, case: item }, null, 2));
    process.stdout.write(`${focused}: replayed\nDiagnostic report: ${output}\n`);
    return;
  }
  const report = runner.finish(scenarios.exclusions);
  const diagnostic = !deployed;
  await writeFile(output, JSON.stringify({ diagnostic, ...(diagnostic ? { reason: "isolated_protocol_fixture" } : {}), ...report }, null, 2));
  process.stdout.write(`Acceptance report: ${output}\n`);
  const budget = report.suite.cases.reduce((n, c) => n + c.observations.length + c.transactions.length + c.simulations.length, contracts.length);
  if (budget > 512) throw new Error("integration-evidence-budget-exceeded");
  const replay = new IntegrationValidationRunner(fixture.chain, context, [], { gasLimit: GAS_LIMIT, timeoutMs: 60 * 60_000, sourceClient });
  for (const item of report.suite.cases) {
    await replay.run(item.id, (r) => r.replay(item)); process.stdout.write(`${item.id}: replayed\n`);
  }
  replay.finish(scenarios.exclusions);
  await writeFile(output, JSON.stringify({ diagnostic, ...(diagnostic ? { reason: "isolated_protocol_fixture" } : {}), ...report }, null, 2));
  const completedLive = deployed ? await loadLive() : undefined;
  if (deployed && !focused && completedLive?.lifecycle) {
    if (![completedLive.lifecycle.active_credit_id, completedLive.lifecycle.recovered_credit_id].every((id) => liveCredits.includes(id))) {
      throw new Error("validation-live-credit-binding-changed");
    }
    const base = new URL("../../../", import.meta.url).pathname;
    const options = definition!.atomic_spot ?? { ...definition!.assessment, maximum_input: definition!.assessment!.action_limits.find((a) => a.action === "kuru_buy")!.maximum_input,
      max_holding: definition!.assessment!.assets[0]!.maximum, dust_limit: definition!.assessment!.assets[0]!.dust,
      oracle: definition!.assessment!.assets[0]!.oracle, feed_id: definition!.assessment!.assets[0]!.feed_id };
    const suite = { ...report.suite, cases: undefined, exclusions: undefined };
    await writeFile(join(output, "../admission.json"), JSON.stringify({ rpcUrl: "https://testnet-rpc.monad.xyz", forkRpcUrl: rpc, suite, module: `${base}server/test/kuru/acceptance.ts`, gasLimit: String(GAS_LIMIT), checkpoint: "checkpoint.json", output: "report.json", timeoutMs: 3_600_000,
      admission: { applicationId: deployment.configuration["kuru-application"].applicationId, apiBase: "http://127.0.0.1:3002", module: `${base}server/dist/kuru/integration.js`, factory: "create_kuru", parameters: {
        market_address: deployment.configuration["kuru-market"].market, settlement_asset: identity!.definition.settlement_asset, api_base: "http://127.0.0.1:3002", maximum_input: options.maximum_input, retained_bps: options.retained_bps, recovery_costs: options.recovery_costs, max_holding: options.max_holding, dust_limit: options.dust_limit, oracle: options.oracle, feed_id: options.feed_id }, amount: "10000", lifecycle: `${base}.data/operations/${liveFile}`, tokenEnv: "TERMBOOK_KURU_APP_TOKEN" } }, null, 2));
  }
  process.stdout.write(`${report.suite.cases.length} acceptance cases passed and replayed; ${report.suite.exclusions.length} cases excluded\n`);
  process.stdout.write(`Acceptance report: ${output}\n`);
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.split("\n")[0] : "validation-failed";
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message.split("\n")[0]}` : "";
  process.stderr.write(`${message}${cause}\n`); process.exitCode = 1;
});
