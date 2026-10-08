import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";

const simulate = process.argv.includes("--simulate");
if (simulate === process.argv.includes("--broadcast")
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast"].includes(arg))) throw new Error("Use --simulate or --broadcast");

async function main() {
  const { deployment, report, context, persist } = await testnetRuntime("account-health-setup", simulate);
  const monad = await context(10143);
  const m = deployment.addresses[10143];
  if (deployment.upgradeMode === "testnet-administrator") {
    const pins = deployment.proxies?.[10143];
    if (!m.AccountHealthSource || !pins?.AccountFactory || !pins?.AccountHealthSource) throw new Error("Account authentication deployment missing");
    const checks = [
      ["TermbookCore", m.TermbookCore, "healthSource", m.AccountHealthSource],
      ["AccountHealthSource", m.AccountHealthSource, "core", m.TermbookCore],
      ["AccountHealthSource", m.AccountHealthSource, "source", m.HealthSource],
      ["AccountHealthSource", m.AccountHealthSource, "accountFactory", m.AccountFactory],
      ["AccountHealthSource", m.AccountHealthSource, "oracleRegistry", m.OracleRegistry],
      ["TestnetProxy", m.AccountFactory, "proxyImplementation", pins.AccountFactory.implementation],
      ["TestnetProxy", m.AccountHealthSource, "proxyImplementation", pins.AccountHealthSource.implementation],
    ];
    for (const [name, address, method, expected] of checks) {
      if ((await monad.read(name, address, method)).toLowerCase() !== expected.toLowerCase()) throw new Error("Account health configuration mismatch");
    }
    log(JSON.stringify({ simulated: simulate, verified: true, transactions: 0, costMON: "0",
      factory: m.AccountFactory, healthSource: m.AccountHealthSource }));
    return;
  }
  if (await monad.read("TermbookCore", m.TermbookCore, "acceptedCredits") !== 0n) throw new Error("Account authentication must precede the first credit");
  const factory = await monad.deploy("AccountFactory", []);
  const source = await monad.deploy("AccountHealthSource", [m.TermbookCore, m.HealthSource, factory]);
  await monad.govern("TermbookCore", m.TermbookCore, "setHealthSource", [source]);
  if ((await monad.read("TermbookCore", m.TermbookCore, "healthSource")).toLowerCase() !== source.toLowerCase()
    || (await monad.read("AccountHealthSource", source, "oracleRegistry")).toLowerCase() !== m.OracleRegistry.toLowerCase()) throw new Error("Account health configuration mismatch");
  report.completedAt = new Date().toISOString();
  persist();
  if (!simulate) {
    const publicReport = { network: "testnet", core: m.TermbookCore, baseHealthSource: m.HealthSource,
      completedAt: report.completedAt, addresses: report.addresses, governance: report.governance,
      transactions: report.transactions.map((tx) => Object.fromEntries(Object.entries(tx).filter(([key]) => key !== "rawTransaction"))) };
    fs.writeFileSync(path.join(root, "deployments/testnet-account-health.json"), JSON.stringify(publicReport, null, 2) + "\n");
    const previousFactory = deployment.accountAuthentication?.previousFactory ?? m.AccountFactory;
    m.AccountFactory = factory;
    m.AccountHealthSource = source;
    deployment.accountAuthentication = { previousFactory, report: "testnet-account-health.json", activatedAt: report.completedAt };
    fs.writeFileSync(path.join(root, "deployments/testnet.json"), JSON.stringify(deployment, null, 2) + "\n");
    const bindingsFile = path.join(root, "packages/bindings/src/generated/deployments.ts");
    let bindings = fs.readFileSync(bindingsFile, "utf8");
    bindings = bindings.replace(/"AccountFactory": "0x[0-9a-fA-F]+"/, `"AccountFactory": "${factory}"`);
    if (!bindings.includes('"AccountHealthSource":')) bindings = bindings.replace(/("HealthSource": "0x[0-9a-fA-F]+",)/, `$1\n    "AccountHealthSource": "${source}",`);
    fs.writeFileSync(bindingsFile, bindings);
    const envFile = path.join(root, ".testnet/server.env");
    const env = fs.readFileSync(envFile, "utf8").replace(/^ACCOUNT_FACTORY_ADDRESS=.*$/m, `ACCOUNT_FACTORY_ADDRESS=${factory}`);
    fs.writeFileSync(envFile, env, { mode: 0o600 });
  }
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, transactions: report.transactions.length, costMON: viem.formatEther(cost), factory, healthSource: source }));
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Account health setup failed"); process.exitCode = 1; });
