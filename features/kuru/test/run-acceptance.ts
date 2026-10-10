import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { keccak256 } from "viem";
import { IntegrationValidationRunner } from "@termbook/sdk";
import { Fixture, word } from "./acceptance-fixture.js";
import { createScenarios, kuru_acceptance_cases } from "./acceptance.js";

async function main() {
  const rpc = process.argv[2] ?? "http://127.0.0.1:18548";
  if (process.argv.length > 3) throw new Error("Usage: pnpm --filter @termbook/kuru test:acceptance [local-fork-rpc]");
  const fixture = new Fixture(rpc);
  await fixture.setup();
  process.stdout.write("Kuru fork fixture configured\n");
  for (const id of [...kuru_acceptance_cases, "control", "duplicate_control", "cure_control", "isolation_control"]) {
    await fixture.facility(id);
    process.stdout.write(`Prepared ${id}\n`);
  }
  const block = await fixture.chain.getBlock({ blockTag: "finalized" });
  const targets = [...new Set([...Object.values(fixture.addresses), ...[...fixture.facilities.values()].map((v) => v.account)])];
  const contracts = [];
  for (const target of targets) {
    const code = await fixture.chain.getBytecode({ address: target, blockNumber: block.number });
    if (!code || code === "0x") throw new Error(`validation-code-missing:${target}`);
    contracts.push({ target, codeHash: keccak256(code) });
  }
  const context = { format: 1 as const, versionId: fixture.bundle, manifestHash: word("Kuru diagnostic manifest"),
    core: fixture.addresses.TermbookCore!, chainId: 10143, mode: "fork" as const, sourceBlock: { number: String(block.number), hash: block.hash },
    forkRpcIdentity: word(rpc), actors: fixture.actors, contracts };
  const output = join(await mkdtemp(join(tmpdir(), "termbook-kuru-acceptance-")), "report.json");
  const runner = new IntegrationValidationRunner(fixture.chain, context, fixture.wallets, { gasLimit: 16_000_000n, timeoutMs: 60 * 60_000,
    pollIntervalMs: 50, onProgress: async (checkpoint) => { await writeFile(output, JSON.stringify({ diagnostic: true, checkpoint }, null, 2)); } });
  const scenarios = await createScenarios(fixture, fixture.actors);
  for (const id of kuru_acceptance_cases) {
    await runner.run(id, scenarios.cases[id]!);
    process.stdout.write(`${id}: passed\n`);
  }
  const report = runner.finish(scenarios.exclusions);
  const budget = report.suite.cases.reduce((n, c) => n + c.observations.length + c.transactions.length + c.simulations.length, contracts.length);
  if (budget > 512) throw new Error("integration-evidence-budget-exceeded");
  const replay = new IntegrationValidationRunner(fixture.chain, context, [], { gasLimit: 16_000_000n, timeoutMs: 60 * 60_000 });
  for (const item of report.suite.cases) await replay.run(item.id, (r) => r.replay(item));
  replay.finish(scenarios.exclusions);
  await writeFile(output, JSON.stringify({ diagnostic: true, admission: "not_admitted", reason: "isolated_protocol_fixture_and_unverified_orderbook_source", ...report }, null, 2));
  process.stdout.write(`${report.suite.cases.length} acceptance cases passed and replayed; ${report.suite.exclusions.length} inapplicable cases excluded\n`);
  process.stdout.write(`Diagnostic report: ${output}\n`);
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.split("\n")[0] : "validation-failed";
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message.split("\n")[0]}` : "";
  process.stderr.write(`${message}${cause}\n`); process.exitCode = 1;
});
