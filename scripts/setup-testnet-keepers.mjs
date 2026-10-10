import { alreadyConfigured, writeConfiguration, clearOperation, readConfiguration } from "./testnet-state.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { log, error } from "node:console";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";
const require = createRequire(path.join(root, "packages/sdk/package.json"));
const { privateKeyToAccount } = require("viem/accounts");
const simulate = process.argv.includes("--simulate");
if (simulate === process.argv.includes("--broadcast")
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast"].includes(arg))) throw new Error("Use --simulate or --broadcast");

async function main() {
  if (!simulate && alreadyConfigured("keepers")) { clearOperation("keeper-setup"); log(JSON.stringify({ configured: true, step: "keepers" })); return; }
  const { deployment, report, context, persist } = await testnetRuntime("keeper-setup", simulate);
  const keys = JSON.parse(fs.readFileSync(path.join(root, ".testnet/keepers.json"), "utf8"));
  const addresses = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, privateKeyToAccount(key).address]));
  if (new Set(Object.values(addresses).map((value) => value.toLowerCase())).size !== Object.keys(addresses).length) throw new Error("Keeper wallets must be distinct");
  const monad = await context(10143);
  const ethereum = await context(11155111);
  await monad.govern("TermbookCore", deployment.addresses[10143].TermbookCore, "setRecoveryKeeper", [addresses.risk, true]);
  async function fund(network, chainId, name, target) {
    report.topups ??= {};
    const id = `${chainId}:${name}`;
    if (report.topups[id] === undefined) {
      const balance = await network.client.getBalance({ address: addresses[name] });
      const minimum = viem.parseEther(target);
      report.topups[id] = (minimum > balance ? minimum - balance : 0n).toString();
      persist();
    }
    const amount = BigInt(report.topups[id]);
    if (amount !== 0n) await network.send(`fund:${name}`, "0x", addresses[name], amount);
  }
  for (const [name, amount] of [["risk", "0.15"], ["collateral", "0.15"], ["monadConfirm", "0.15"], ["monadPublisher", "0.08"], ["solanaProof", "0.15"], ["oracle", "0.2"]]) {
    await fund(monad, 10143, name, amount);
  }
  for (const name of ["ethereumPublisher", "sourceAction"]) await fund(ethereum, 11155111, name, "0.001");
  await ethereum.govern("RemoteCollateralController", deployment.addresses[11155111].RemoteCollateralController, "setPaused", [false]);
  report.completedAt = new Date().toISOString();
  report.keepers = addresses;
  persist();
  if (!simulate) {
    const envFile = path.join(root, ".env");
    const bindings = { RISK_KEEPER_KEY: keys.risk, COLLATERAL_KEEPER_KEY: keys.collateral,
      MONAD_CONFIRM_KEEPER_KEY: keys.monadConfirm, MONAD_WORMHOLE_PUBLISHER_KEY: keys.monadPublisher,
      SOLANA_COLLATERAL_KEEPER_KEY: keys.solanaProof, SOURCE_WORMHOLE_PUBLISHER_KEY: keys.ethereumPublisher,
      SOURCE_ACTION_KEEPER_KEY: keys.sourceAction, ORACLE_KEEPER_KEY: keys.oracle };
    const setup = readConfiguration("setup", deployment);
    const ratio = setup.addresses.RatioPriceFeed;
    bindings.RATIO_PRICE_FEEDS = JSON.stringify([{ address: ratio, codeHash: viem.keccak256(await monad.client.getCode({ address: ratio })) }]);
    let env = fs.readFileSync(envFile, "utf8");
    for (const [name, value] of Object.entries(bindings)) {
      env = env.replace(new RegExp(`^${name}=.*\\n?`, "m"), "");
      env += `${name}=${value}\n`;
    }
    fs.writeFileSync(envFile, env, { mode: 0o600 });
    writeConfiguration("keepers", { network: "testnet",
      completedAt: report.completedAt, core: deployment.addresses[10143].TermbookCore, keepers: addresses,
      transactions: report.transactions.map((tx) => Object.fromEntries(Object.entries(tx).filter(([key]) => key !== "rawTransaction"))),
      governance: report.governance, topups: report.topups });
  }
  const costs = Object.fromEntries([10143, 11155111].map((chain) => [chain, viem.formatEther(report.transactions
    .filter((tx) => tx.chainId === chain).reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice) + BigInt(tx.value), 0n))]));
  log(JSON.stringify({ simulated: simulate, transactions: report.transactions.length, costs }));
  if (!simulate) clearOperation("keeper-setup", false);
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Keeper setup failed"); process.exitCode = 1; });
