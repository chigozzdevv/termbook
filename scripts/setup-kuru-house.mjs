import { alreadyConfigured, writeConfiguration, clearOperation, operationFile } from "./testnet-state.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { log, error } from "node:console";
import { root, viem, artifact, testnetRuntime } from "./testnet-runtime.mjs";

const require = createRequire(path.join(root, "packages/sdk/package.json"));
const { privateKeyToAccount } = require("viem/accounts");
const simulate = process.argv.includes("--simulate");
if (simulate === process.argv.includes("--broadcast")
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast"].includes(arg))) throw new Error("Use --simulate or --broadcast");
const asset = "0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570";
const market = "0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9";
const canonical = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item).toLowerCase();
function equal(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) throw new Error(`Kuru House mismatch: ${label}`);
}

async function main() {
  if (!simulate && alreadyConfigured("kuru-house")) { clearOperation("kuru-house"); log(JSON.stringify({ configured: true, step: "kuru-house" })); return; }
  const runtime = await testnetRuntime("kuru-house", simulate);
  const { deployment, report, context, persist } = runtime;
  const monad = await context(10143), m = deployment.addresses[10143];
  const identity = JSON.parse(fs.readFileSync(path.join(root, ".testnet/kuru-house-wallet.json"), "utf8"));
  const house = identity.address;
  equal(privateKeyToAccount(identity.privateKey).address, house, "House quote signer");
  if (!/^0x[a-fA-F0-9]{40}$/.test(house) || /^0x0{40}$/i.test(house)
    || house.toLowerCase() === deployment.deployer.toLowerCase()) throw new Error("Separate House identity required");
  const params = await monad.client.readContract({ address: market,
    abi: viem.parseAbi(["function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)"]),
    functionName: "getMarketParams", blockTag: "finalized" });
  equal(params[4], asset, "Kuru settlement token");
  equal(params[5], 6n, "settlement decimals");
  const pin = deployment.proxies[10143].HouseVault;
  const implementation = await monad.read("TestnetProxy", m.HouseVault, "proxyImplementation");
  equal(implementation, pin.implementation, "existing House implementation");
  equal(viem.keccak256(await monad.client.getCode({ address: implementation })), pin.implementationCodeHash, "implementation code");
  const binding = { house, manager: deployment.deployer, asset, implementation, core: m.TermbookCore };
  if (report.binding) equal(report.binding, binding, "journal binding");
  report.binding = binding;
  const snapshot = async () => Object.fromEntries(await Promise.all(["asset", "totalAssets", "totalShares", "freeCash", "activeCreditCount"]
    .map(async (method) => [method, String(await monad.read("HouseVault", m.HouseVault, method))])));
  report.originalHouse ??= await snapshot();
  persist();
  if (!simulate && !report.completedAt) {
    const rehearsal = JSON.parse(fs.readFileSync(operationFile("kuru-house-simulation"), "utf8"));
    equal(rehearsal.binding, binding, "simulation binding");
    if (!rehearsal.completedAt || !rehearsal.transactions.every((tx) => tx.status === "success")) throw new Error("Successful simulation required");
    const gas = rehearsal.transactions.reduce((sum, tx) => sum + BigInt(tx.gasLimit), 0n);
    const price = await monad.client.getGasPrice();
    const budget = gas * (price > 100_000_000_000n ? price : 100_000_000_000n) + 100_000_000_000_000_000n;
    if (await monad.client.getBalance({ address: deployment.deployer }) < budget) throw new Error("Insufficient House setup gas");
  }
  const guardian = await monad.read("HouseVault", m.HouseVault, "pauseGuardian");
  const initialization = viem.encodeFunctionData({ abi: artifact("HouseVault").abi, functionName: "initialize",
    args: [asset, m.TermbookCore, deployment.deployer, m.InboxFactory, guardian] });
  const vault = await monad.deploy("TestnetProxy", [implementation, m.UpgradeController, initialization], "KuruHouseVault");
  await monad.govern("UpgradeController", m.UpgradeController, "register", [vault]);
  const registered = await monad.read("HouseRegistry", m.HouseRegistry, "houses", [house]);
  if (registered[3] && registered[0].toLowerCase() !== vault.toLowerCase()) throw new Error("House identity already in use");
  await monad.govern("HouseRegistry", m.HouseRegistry, "register", [house, vault, asset, deployment.deployer]);
  await monad.call("HouseRegistry", m.HouseRegistry, "setPolicy", [house, 1n, 5_000_000n, 60n, 86_400n, 1000n, 100n, 100n], "KuruHouse.policy");
  await monad.call("HouseRegistry", m.HouseRegistry, "setRiskPolicy", [house, 12_500n, 12_000n, 11_750n, 11_500n, 11_000n], "KuruHouse.risk");
  await monad.govern("TermbookCore", m.TermbookCore, "configureReservationPolicy", [house, 1n, {
    vault, maxSetupDuration: 7200, annualRateBps: 100, maxBorrowerCount: 4, maxHouseCount: 8,
    maxBorrowerLimit: 5_000_000n, maxHouseLimit: 10_000_000n, readyFee: 1000n, abandonFee: 5000n,
    expiryFee: 5000n, repeatPenalty: 1000n, maxSlippageBps: 500,
  }]);
  equal(await monad.read("HouseRegistry", m.HouseRegistry, "houses", [house]), [vault, asset, deployment.deployer, true], "registration");
  for (const [method, expected] of Object.entries({ asset, core: m.TermbookCore, manager: deployment.deployer,
    inboxFactory: m.InboxFactory, pauseGuardian: guardian })) equal(await monad.read("HouseVault", vault, method), expected, method);
  equal(await monad.read("TestnetProxy", vault, "proxyImplementation"), implementation, "new proxy implementation");
  const admin = await monad.read("TestnetProxy", vault, "proxyAdmin");
  equal(await monad.client.readContract({ address: admin, abi: viem.parseAbi(["function owner() view returns(address)"]), functionName: "owner" }), m.UpgradeController, "upgrade owner");
  equal(await monad.read("UpgradeController", m.UpgradeController, "contractIds", [vault]), pin.contractId, "upgrade identity");
  equal(await monad.read("HouseRegistry", m.HouseRegistry, "isActiveHouse", [deployment.deployer, m.HouseVault]), true, "original House registration");
  equal(await snapshot(), report.originalHouse, "preserved original House accounting");
  const cash = await monad.read("HouseVault", vault, "freeCash");
  const balance = await monad.client.readContract({ address: asset, abi: viem.parseAbi(["function balanceOf(address) view returns(uint256)"]),
    functionName: "balanceOf", args: [deployment.deployer] });
  report.completedAt ??= new Date().toISOString();
  report.readiness = { funded: cash > 0n, freeCash: String(cash), deployerAssetBalance: String(balance), integrationAdmitted: false };
  report.proxy = { address: vault, implementation, admin, contractId: pin.contractId, implementationCodeHash: pin.implementationCodeHash };
  persist();
  if (!simulate) writeConfiguration("kuru-house", {
    network: "testnet", chainId: 10143, purpose: "Separate House for Kuru testnet USDC", ...binding,
    completedAt: report.completedAt, proxy: report.proxy, readiness: report.readiness, originalHouse: m.HouseVault,
    originalHouseAccounting: report.originalHouse,
    transactions: JSON.parse(JSON.stringify(report.transactions, (key, value) => key === "rawTransaction" ? undefined : value)),
  });
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, house, vault, transactions: report.transactions.length, costMON: viem.formatEther(cost), ...report.readiness }));
  if (!simulate) clearOperation("kuru-house", false);
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Kuru House setup failed"); process.exitCode = 1; });
