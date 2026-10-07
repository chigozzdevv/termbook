import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";
import { verifySettledCredits } from "./testnet-replacement.mjs";

const simulate = process.argv.includes("--simulate");
if (simulate === process.argv.includes("--broadcast")
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast"].includes(arg))) throw new Error("Use --simulate or --broadcast");

async function main() {
  const { deployment, report, context, persist } = await testnetRuntime("replacement-migration", simulate);
  const monad = await context(10143);
  const source = await context(11155111);
  const m = deployment.addresses[10143];
  const evidence = JSON.parse(fs.readFileSync(path.join(root, "deployments/testnet-e2e.json"), "utf8"));
  report.credits = await verifySettledCredits(deployment, evidence,
    (chainId, name, address, method, args = []) => (chainId === 10143 ? monad : source).read(name, address, method, args));
  for (const method of ["committedCash", "drawnPrincipal", "accruedReceivables", "pendingSettlement", "bondCash",
    "bondLiabilities", "impairment", "unresolvedCreditImpairment", "queuedWithdrawalShares"]) {
    if (await monad.read("HouseVault", m.HouseVault, method) !== 0n) throw new Error(`Previous House has outstanding ${method}`);
  }
  const shares = await monad.read("HouseVault", m.HouseVault, "shares", [deployment.deployer]);
  if (shares !== await monad.read("HouseVault", m.HouseVault, "totalShares")) throw new Error("Previous House has other LPs");
  if (report.withdrawalShares === undefined) {
    report.withdrawalShares = shares.toString();
    report.withdrawalAmount = (await monad.read("HouseVault", m.HouseVault, "availableCash")).toString();
    persist();
  }
  await monad.govern("HouseRegistry", m.HouseRegistry, "disable", [deployment.deployer]);
  await monad.call("HouseVault", m.HouseVault, "setDepositsOpen", [false]);
  if (BigInt(report.withdrawalShares) !== 0n) {
    await monad.call("HouseVault", m.HouseVault, "requestWithdraw", [BigInt(report.withdrawalShares)]);
  }
  await monad.call("HouseVault", m.HouseVault, "setPaused", [true]);
  await source.govern("RemoteCollateralController", deployment.addresses[11155111].RemoteCollateralController, "setPaused", [true]);
  const balance = await monad.client.readContract({ address: deployment.tokens[10143].USDC,
    abi: viem.parseAbi(["function balanceOf(address) view returns(uint256)"]), functionName: "balanceOf", args: [m.HouseVault] });
  if (balance !== 0n || await monad.read("HouseVault", m.HouseVault, "totalShares") !== 0n
    || await monad.read("HouseRegistry", m.HouseRegistry, "isActiveHouse", [deployment.deployer, m.HouseVault])) {
    throw new Error("Previous House migration incomplete");
  }
  report.completedAt = new Date().toISOString();
  persist();
  if (!simulate) fs.writeFileSync(path.join(root, "deployments/testnet-migration.json"), JSON.stringify({
    network: "testnet", previousCore: m.TermbookCore, previousHouse: m.HouseVault,
    recipient: deployment.deployer, withdrawalAmount: report.withdrawalAmount, completedAt: report.completedAt,
    credits: report.credits, transactions: report.transactions.map(({ rawTransaction: _rawTransaction, ...tx }) => tx),
  }, null, 2) + "\n");
  log(JSON.stringify({ simulated: simulate, withdrawnUSDC: viem.formatUnits(BigInt(report.withdrawalAmount), 6), transactions: report.transactions.length }));
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Testnet migration failed"); process.exitCode = 1; });
