import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPublicClient, http, keccak256, toHex, parseAbi, type Address, type Hex } from "viem";
import { IntegrationValidationRunner, atomic_configuration } from "@termbook/sdk";
import type { IntegrationSuite } from "@termbook/schema";
import { Fixture, word } from "./acceptance-fixture.js";
import { DeploymentFixture } from "./deployment-fixture.js";
import { createScenarios, kuru_acceptance_cases } from "./acceptance.js";

async function main() {
  const rpc = process.argv[2] ?? "http://127.0.0.1:18548";
  const deployed = process.argv[3] === "--deployment";
  if (process.argv.length !== (deployed ? 4 : process.argv[2] ? 3 : 2)) throw new Error("Use [local-fork-rpc], optionally with --deployment");
  const deployment = deployed ? JSON.parse(await readFile("deployments/testnet.json", "utf8")) : undefined;
  const keeper = process.env["RISK_KEEPER_KEY"];
  const borrower = deployed ? JSON.parse(await readFile(".testnet/evm.json", "utf8")).privateKey : undefined;
  if (deployed && (!keeper || !/^0x[a-fA-F0-9]{64}$/.test(keeper))) throw new Error("validation-live-keeper-key-required");
  const fixture = deployed ? new DeploymentFixture(rpc, deployment, [borrower as Hex, keeper as Hex, toHex(0xbadn, { size: 32 })]) : new Fixture(rpc);
  await fixture.setup();
  process.stdout.write("Kuru fork fixture configured\n");
  const ids = [...kuru_acceptance_cases, "control", "duplicate_control", "cure_control", "isolation_control"];
  if (fixture instanceof DeploymentFixture) await fixture.warmCredits(ids);
  for (const id of ids) {
    await fixture.facility(id);
    process.stdout.write(`Prepared ${id}\n`);
  }
  const block = await fixture.chain.getBlock({ blockTag: "finalized" });
  const identity = deployed ? atomic_configuration(deployment.configuration["kuru-integration"].definition) : undefined;
  const live = deployed ? JSON.parse(await readFile(".data/operations/testnet-kuru-e2e.json", "utf8")) : undefined;
  const names = ["TermbookCore", "FlowExecutor", "ReservationManager", "PriceProtection", "RiskEngine", "HouseRegistry", "IntegrationRegistry", "OracleRegistry", "CollateralHealthReader", "AppHealthReader", "HealthSource", "AccountHealthSource", "AtomicSpotRouter", "AtomicSpotModule", "ReadProgram", "AccountFactory", "HouseVault", "InboxFactory", "CollateralVault", "SpotAcceptanceProbe", "MockERC20", "PriceFeedFixture", "USDPriceFeedFixture", "SpotCallbackFixture", "CallbackRouter", "Circle", "Kuru"];
  const targets = [...new Set([...(deployed ? names.map((name) => fixture.addresses[name]!).filter(Boolean) : Object.values(fixture.addresses)), ...fixture.guards,
    ...[...fixture.facilities.values()].map((v) => v.account), ...(identity?.definition.pins.map((p) => p.target as Address) ?? []),
    ...(fixture instanceof DeploymentFixture ? [fixture.liveHouse, ...[...fixture.helpers].map((v) => v as Address)] : [])].map((v) => v.toLowerCase() as Address))];
  if (live?.lifecycle) for (const id of [live.lifecycle.active_credit_id, live.lifecycle.recovered_credit_id]) {
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
  const runner = new IntegrationValidationRunner(fixture.chain, context, fixture.wallets, { gasLimit: 16_000_000n, timeoutMs: 60 * 60_000, sourceClient,
    pollIntervalMs: 50, onProgress: async (checkpoint) => { await writeFile(output, JSON.stringify({ diagnostic: true, checkpoint }, null, 2)); } });
  const scenarios = await createScenarios(fixture, fixture.actors);
  for (const id of kuru_acceptance_cases) {
    await runner.run(id, scenarios.cases[id]!);
    process.stdout.write(`${id}: passed\n`);
  }
  const report = runner.finish(scenarios.exclusions);
  await writeFile(output, JSON.stringify({ diagnostic: !deployed, ...(!deployed ? { reason: "isolated_protocol_fixture" } : {}), ...report }, null, 2));
  process.stdout.write(`Acceptance report: ${output}\n`);
  const budget = report.suite.cases.reduce((n, c) => n + c.observations.length + c.transactions.length + c.simulations.length, contracts.length);
  if (budget > 512) throw new Error("integration-evidence-budget-exceeded");
  const replay = new IntegrationValidationRunner(fixture.chain, context, [], { gasLimit: 16_000_000n, timeoutMs: 60 * 60_000, sourceClient });
  for (const item of report.suite.cases) {
    await replay.run(item.id, (r) => r.replay(item)); process.stdout.write(`${item.id}: replayed\n`);
  }
  replay.finish(scenarios.exclusions);
  await writeFile(output, JSON.stringify({ diagnostic: !deployed, ...(!deployed ? { reason: "isolated_protocol_fixture" } : {}), ...report }, null, 2));
  if (deployed && live?.lifecycle) {
    const base = new URL("../../../", import.meta.url).pathname;
    const options = deployment.configuration["kuru-integration"].definition.atomic_spot;
    const suite = { ...report.suite, cases: undefined, exclusions: undefined };
    await writeFile(join(output, "../admission.json"), JSON.stringify({ rpcUrl: "https://testnet-rpc.monad.xyz", forkRpcUrl: rpc, suite, module: `${base}features/kuru/test/acceptance.ts`, gasLimit: "16000000", checkpoint: "checkpoint.json", output: "report.json", timeoutMs: 3_600_000,
      admission: { applicationId: deployment.configuration["kuru-application"].applicationId, apiBase: "http://127.0.0.1:3002", module: `${base}features/kuru/dist/integration.js`, factory: "create_kuru", parameters: {
        market_address: deployment.configuration["kuru-market"].market, settlement_asset: identity!.definition.settlement_asset, api_base: "http://127.0.0.1:3002", maximum_input: options.maximum_input, retained_bps: options.retained_bps, recovery_costs: options.recovery_costs, max_holding: options.max_holding, dust_limit: options.dust_limit, oracle: options.oracle, feed_id: options.feed_id }, amount: "10000", lifecycle: `${base}.data/operations/testnet-kuru-e2e.json`, tokenEnv: "TERMBOOK_KURU_APP_TOKEN" } }, null, 2));
  }
  process.stdout.write(`${report.suite.cases.length} acceptance cases passed and replayed; ${report.suite.exclusions.length} inapplicable cases excluded\n`);
  process.stdout.write(`Acceptance report: ${output}\n`);
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.split("\n")[0] : "validation-failed";
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message.split("\n")[0]}` : "";
  process.stderr.write(`${message}${cause}\n`); process.exitCode = 1;
});
