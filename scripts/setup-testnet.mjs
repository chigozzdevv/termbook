import { alreadyConfigured, writeConfiguration, clearOperation } from "./testnet-state.mjs";
import process from "node:process";
import { log, error } from "node:console";
import { execFileSync } from "node:child_process";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";
import { reuseGuard } from "./testnet-guards.mjs";

const simulate = process.argv.includes("--simulate");
if (simulate === process.argv.includes("--broadcast")
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast"].includes(arg))) {
  throw new Error("Use --simulate or --broadcast");
}

const feeds = {
  ETH: { id: viem.keccak256(viem.stringToHex("testnet:ETH/USD")), address: "0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31", implementation: "0xF648D8F0ed894c99A12de5Df3020Cd273e841Bd4" },
  USDC: { id: viem.keccak256(viem.stringToHex("testnet:USDC/USD")), address: "0x39820e7965e29DC86b94F20eD04e9c5cCf9aFf95", implementation: "0x56395e94c93DE46598537C4A81811a7a743D0826" },
};
const priceId = viem.keccak256(viem.stringToHex("testnet:ETH/USDC"));
const maxAge = 90_000n;
const deposit = 10_000_000n;
const erc20 = viem.parseAbi(["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"]);

async function main() {
  if (!simulate && alreadyConfigured("setup")) { clearOperation("setup"); log(JSON.stringify({ configured: true, step: "setup" })); return; }
  const runtime = await testnetRuntime("setup", simulate);
  const { deployment, report, context, persist } = runtime;
  const monad = await context(10143);
  const m = deployment.addresses[10143];
  const usdc = deployment.tokens[10143].USDC;
  const weth = deployment.tokens[11155111].WETH;
  report.sourceCommit ??= execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  for (const [name, feed] of Object.entries(feeds)) {
    const getter = viem.toFunctionSelector("aggregator()");
    const guard = await reuseGuard(runtime, monad, "setup", `${name}FeedGuard`, "ImplementationGuard", feed.address, feed.implementation, getter)
      ?? await monad.deploy("ImplementationGuard", [feed.address, feed.implementation, getter], `${name}FeedGuard`);
    await monad.govern("OracleRegistry", m.OracleRegistry, "setFeed", [feed.id, feed.address, maxAge, 8]);
    await monad.govern("OracleRegistry", m.OracleRegistry, "setFeedGuard", [feed.id, guard]);
    const price = await monad.read("OracleRegistry", m.OracleRegistry, "read", [feed.id]);
    report.prices ??= {};
    report.prices[name] = price.map(String);
    persist();
  }
  const ratio = await monad.deploy("RatioPriceFeed", [m.OracleRegistry, feeds.ETH.id, feeds.USDC.id]);
  await monad.call("RatioPriceFeed", ratio, "update", [], `RatioPriceFeed.update:${report.prices.ETH[2]}:${report.prices.USDC[2]}`);
  await monad.govern("OracleRegistry", m.OracleRegistry, "setFeed", [priceId, ratio, maxAge, 18]);
  await monad.govern("TermbookCore", m.TermbookCore, "setHealthMaxAge", [maxAge]);
  await monad.govern("TermbookCore", m.TermbookCore, "setRemoteSalePolicy", [11155111n, weth, usdc, m.OracleRegistry, priceId, 18, 9500, 10_000_000_000_000_000n]);
  await monad.govern("CollateralHealthReader", m.CollateralHealthReader, "setMarket", [11155111n, weth, usdc, priceId, 18, 8000, 50_000n]);
  await monad.call("HouseRegistry", m.HouseRegistry, "setPolicy", [deployment.deployer, 1n, 5_000_000n, 60n, 86_400n, 1000n, 100n, 100n]);
  await monad.call("HouseRegistry", m.HouseRegistry, "setRiskPolicy", [deployment.deployer, 12_500n, 12_000n, 11_750n, 11_500n, 11_000n]);
  await monad.govern("TermbookCore", m.TermbookCore, "configureReservationPolicy", [deployment.deployer, 1n, {
    vault: m.HouseVault, maxSetupDuration: 7200, annualRateBps: 100, maxBorrowerCount: 4,
    maxHouseCount: 8, maxBorrowerLimit: 5_000_000n, maxHouseLimit: deposit,
    readyFee: 1000n, abandonFee: 5000n, expiryFee: 5000n, repeatPenalty: 1000n, maxSlippageBps: 500,
  }]);
  if (!report.transactions.some((tx) => tx.name === "HouseVault.deposit")) {
    const balance = await monad.client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [deployment.deployer] });
    if (balance < deposit) throw new Error("Insufficient test USDC for House liquidity");
  }
  await monad.send("USDC.approveHouse", viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [m.HouseVault, deposit] }), usdc);
  await monad.call("HouseVault", m.HouseVault, "deposit", [deployment.deployer, deposit]);
  const houseCash = await monad.read("HouseVault", m.HouseVault, "freeCash");
  const shares = await monad.read("HouseVault", m.HouseVault, "shares", [deployment.deployer]);
  if (houseCash < deposit || shares < deposit) throw new Error("House liquidity accounting mismatch");
  const ratioPrice = await monad.read("OracleRegistry", m.OracleRegistry, "read", [priceId]);
  report.completedAt = new Date().toISOString();
  report.verification = { houseCash: houseCash.toString(), lpShares: shares.toString(), ratioPrice: ratioPrice.map(String) };
  persist();
  const publicReport = { network: "testnet", simulated: simulate, sourceCommit: report.sourceCommit,
    completedAt: report.completedAt, core: m.TermbookCore, addresses: report.addresses,
    feeds, priceId, maxAgeSeconds: Number(maxAge), housePolicyVersion: 1,
    transactions: report.transactions.map((tx) => Object.fromEntries(Object.entries(tx).filter(([key]) => key !== "rawTransaction"))),
    governance: report.governance, reusedContracts: report.reusedContracts, verification: report.verification };
  if (!simulate) writeConfiguration("setup", publicReport);
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, transactions: report.transactions.length,
    costMON: viem.formatEther(cost), ...report.verification }));
  if (!simulate) clearOperation("setup", false);
}

main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Testnet setup failed"); process.exitCode = 1; });
