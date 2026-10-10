import { alreadyConfigured, writeConfiguration, clearOperation } from "./testnet-state.mjs";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { log, error } from "node:console";
import { execFileSync } from "node:child_process";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";
import { reuseGuard } from "./testnet-guards.mjs";

const simulate = process.argv.includes("--simulate");
const native = process.argv.includes("--native");
if (simulate === process.argv.includes("--broadcast")
  || new Set(process.argv.slice(2)).size !== process.argv.length - 2
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast", "--native"].includes(arg))) {
  throw new Error("Use --simulate or --broadcast with optional --native");
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
  if (native) { await setupNative(); return; }
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

async function setupNative() {
  const runtime = await testnetRuntime("native-setup", simulate);
  const { deployment, report, persist } = runtime;
  const monad = await runtime.context(10143);
  const m = deployment.addresses[10143];
  const usdc = deployment.tokens[10143].USDC;
  const configured = deployment.configuration?.native;
  if (configured && configured.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Native configuration belongs to another Core");
  const asset = await monad.read("NativeCollateralVault", m.NativeCollateralVault, "asset");
  if ((await monad.read("NativeCollateralVault", m.NativeCollateralVault, "core")).toLowerCase() !== m.TermbookCore.toLowerCase()
    || await monad.read("NativeCollateralVault", m.NativeCollateralVault, "chainId_") !== 10143n) throw new Error("Native vault binding mismatch");
  const pyth = "0xFC6bd9F9f0c6481c6Af3A7Eb46b296A5B85ed379";
  const pythId = "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1";
  const monId = viem.keccak256(viem.stringToHex("testnet:MON/USD"));
  const ratioId = viem.keccak256(viem.stringToHex("testnet:MON/USDC:live"));
  if (!configured) {
    const feed = await monad.deploy("PythPriceFeed", [pyth, pythId, 300n, 200n], "MONPriceFeed");
    await monad.govern("OracleRegistry", m.OracleRegistry, "setFeed", [monId, feed, 300n, 18]);
    const ratio = await monad.deploy("LiveRatioPriceFeed", [m.OracleRegistry, monId, feeds.USDC.id], "MONLiveRatioPriceFeed");
    await monad.govern("OracleRegistry", m.OracleRegistry, "setFeed", [ratioId, ratio, maxAge, 18]);
    await monad.govern("TermbookCore", m.TermbookCore, "setLocalSalePolicy", [asset, usdc, m.OracleRegistry, ratioId, 9500, viem.parseEther("100")]);
    await monad.govern("CollateralHealthReader", m.CollateralHealthReader, "setMarket", [10143n, asset, usdc, ratioId, 18, 8000, 1000n]);
  }
  const vaultHash = viem.keccak256(await monad.client.getCode({ address: m.NativeCollateralVault }));
  if (await monad.read("TermbookCore", m.TermbookCore, "localCollateralVaultCodeHash", [m.NativeCollateralVault]) !== vaultHash) {
    await monad.govern("TermbookCore", m.TermbookCore, "setLocalCollateralVault", [m.NativeCollateralVault, vaultHash]);
  }
  const guardian = await monad.read("TermbookCore", m.TermbookCore, "guardian");
  if ((await monad.read("NativeCollateralVault", m.NativeCollateralVault, "pauseGuardian")).toLowerCase() !== guardian.toLowerCase()) {
    await monad.govern("TermbookCore", m.TermbookCore, "setCollateralPauseGuardian", [m.NativeCollateralVault, guardian]);
  }
  const price = await monad.read("OracleRegistry", m.OracleRegistry, "read", [ratioId]);
  const policy = await monad.read("TermbookCore", m.TermbookCore, "localSalePolicies", [await monad.read("TermbookCore", m.TermbookCore, "localSaleMarketId", [asset, usdc])]);
  if (!policy.at(-1) || policy[1] !== ratioId) throw new Error("Native sale policy mismatch");
  if (!simulate) {
    const file = path.join(root, ".env");
    let env = fs.readFileSync(file, "utf8");
    const markets = JSON.parse(env.match(/^COLLATERAL_MARKETS=(.*)$/m)?.[1] ?? "[]").filter((market) => market.id !== "mon-testnet");
    markets.push({ id: "mon-testnet", label: "MON (testnet)", kind: "evm", chainId: 10143, decimals: 18,
      asset, vault: m.NativeCollateralVault, controller: m.TermbookCore,
      rpcUrl: "https://testnet-rpc.monad.xyz", nativeVault: true });
    env = env.replace(/^COLLATERAL_MARKETS=.*\n?/m, "");
    fs.writeFileSync(file, `${env}COLLATERAL_MARKETS=${JSON.stringify(markets)}\n`, { mode: 0o600 });
  }
  report.completedAt = new Date().toISOString(); persist();
  if (!simulate) writeConfiguration("native", { ...configured, core: m.TermbookCore, completedAt: report.completedAt, asset,
    vault: m.NativeCollateralVault, pyth, pythId, priceId: ratioId, retainedSourceBps: 8000,
    recoveryCosts: "1000", addresses: { ...configured?.addresses, ...report.addresses }, transactions: report.transactions });
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, step: "native", transactions: report.transactions.length, costMON: viem.formatEther(cost), price: price.map(String) }));
  clearOperation("native-setup", simulate);
}

main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Testnet setup failed"); process.exitCode = 1; });
