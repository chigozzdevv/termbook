import { alreadyConfigured, writeConfiguration, clearOperation } from "./testnet-state.mjs";
import process from "node:process";
import { log, error } from "node:console";
import { viem, testnetRuntime } from "./testnet-runtime.mjs";
import { reuseGuard } from "./testnet-guards.mjs";

const simulate = process.argv.includes("--simulate");
if (simulate === process.argv.includes("--broadcast")
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast"].includes(arg))) throw new Error("Use --simulate or --broadcast");
const bundleId = viem.keccak256(viem.stringToHex("Termbook testnet reference asset app v1"));

async function main() {
  if (!simulate && alreadyConfigured("app")) { clearOperation("app-setup"); log(JSON.stringify({ configured: true, step: "app" })); return; }
  const runtime = await testnetRuntime("app-setup", simulate);
  const { deployment, report, context, persist } = runtime;
  const monad = await context(10143);
  const m = deployment.addresses[10143];
  const token = deployment.tokens[10143].USDC;
  const app = await monad.deploy("ReferenceAssetApp", [m.TermbookCore, token]);
  const codeHash = viem.keccak256(await monad.client.getCode({ address: app }));
  await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "approve", [bundleId, codeHash]);
  for (const [method, spending] of [["deposit", true], ["withdraw", false]]) {
    const selector = viem.toFunctionSelector(`${method}(uint256)`);
    const validator = await monad.deploy("StaticCallValidator", [bundleId, app, selector, !spending,
      [{ kind: spending ? 3 : 2, exact: viem.zeroHash, minimum: 1n, maximum: 5_000_000n }]], `${method}Validator`);
    await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "registerCall", [bundleId, app, selector, 36n, 255, 0, 5_000_000n]);
    await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "setCallValidator", [bundleId, app, selector, validator]);
    if (!spending) {
      await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "registerRecoveryCall", [bundleId, app, selector, 36n, 255]);
      await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "setRecoveryCallValidator", [bundleId, app, selector, validator]);
    }
  }
  await monad.govern("TermbookCore", m.TermbookCore, "setAppRecoveryAdapter", [bundleId, app]);
  await monad.govern("TermbookCore", m.TermbookCore, "setExitPlanner", [bundleId, app]);
  await monad.govern("TermbookCore", m.TermbookCore, "configureExecutionPolicy", [bundleId, app, 1, 0, 300]);
  const health = await monad.deploy("AppHealthReader", [m.TermbookCore, bundleId, m.CollateralHealthReader, app, app]);
  const exit = await monad.deploy("AppExitVerifier", [m.TermbookCore, app]);
  await monad.govern("HealthSource", m.HealthSource, "setReader", [bundleId, health, 1n, 90_000n]);
  await monad.govern("TermbookCore", m.TermbookCore, "setExitVerifier", [bundleId, exit]);
  await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "pinDependency", [bundleId, token]);
  const implementation = await monad.client.readContract({ address: token,
    abi: viem.parseAbi(["function implementation() view returns(address)"]), functionName: "implementation" });
  if (implementation.toLowerCase() !== "0x21240161521d6854be79f7d3a0a65c6beddb42fb") throw new Error("Test USDC implementation changed");
  const getter = viem.toFunctionSelector("implementation()");
  const libraries = ["0x3f6a0d6a83e50219626aa6a84fd237cb1877884d"];
  const tokenGuard = await reuseGuard(runtime, monad, "app", "USDCImplementationGuard", "LinkedLibraryGuard", token, implementation, getter, libraries)
    ?? await monad.deploy("LinkedLibraryGuard", [token, implementation, getter, libraries], "USDCImplementationGuard");
  await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "setDependencyGuard", [bundleId, token, tokenGuard]);
  await monad.govern("IntegrationRegistry", m.IntegrationRegistry, "activate", [bundleId]);
  if (!await monad.read("IntegrationRegistry", m.IntegrationRegistry, "isActive", [bundleId])) throw new Error("Reference integration inactive");
  report.completedAt = new Date().toISOString();
  report.bundleId = bundleId;
  report.codeHash = codeHash;
  persist();
  if (!simulate) writeConfiguration("app", { network: "testnet",
    purpose: "Reference application for live custody, valuation, execution, and recovery tests; not a perps venue",
    core: m.TermbookCore, bundleId, codeHash, completedAt: report.completedAt, addresses: report.addresses,
    governance: report.governance, reusedContracts: report.reusedContracts, transactions: report.transactions.map((tx) => Object.fromEntries(
      Object.entries(tx).filter(([key]) => key !== "rawTransaction"))) });
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, transactions: report.transactions.length, costMON: viem.formatEther(cost), bundleId, app }));
  if (!simulate) clearOperation("app-setup", false);
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Testnet app setup failed"); process.exitCode = 1; });
