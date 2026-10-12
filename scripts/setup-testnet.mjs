import { alreadyConfigured, writeConfiguration, writeJsonAtomic, clearOperation, operationFile } from "./testnet-state.mjs";
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { log, error } from "node:console";
import { execFileSync } from "node:child_process";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";
import { reuseGuard } from "./testnet-guards.mjs";

const simulate = process.argv.includes("--simulate");
const native = process.argv.includes("--native");
const fresh = process.argv.includes("--fresh-prices");
const alignHealth = process.argv.includes("--align-health");
if (simulate === process.argv.includes("--broadcast")
  || [native, fresh, alignHealth].filter(Boolean).length > 1
  || new Set(process.argv.slice(2)).size !== process.argv.length - 2
  || process.argv.slice(2).some((arg) => !["--simulate", "--broadcast", "--native", "--fresh-prices", "--align-health"].includes(arg))) {
  throw new Error("Use --simulate or --broadcast with optional --native, --fresh-prices or --align-health");
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
  if (alignHealth) { await setupHealthFreshness(); return; }
  if (fresh) { await setupFreshPrices(); return; }
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

async function setupHealthFreshness() {
  const operation = "health-freshness";
  const runtime = await testnetRuntime(operation, simulate);
  const { deployment, report, persist } = runtime;
  const network = await runtime.context(10143), m = deployment.addresses[10143];
  const { artifact } = await import("./testnet-runtime.mjs");
  const readerHash = viem.keccak256(artifact("CollateralHealthReader").deployedBytecode.object);
  const age = 300n;
  const previous = deployment.configuration[operation];
  if (previous?.completedAt && previous.readerCodeHash === readerHash
    && previous.addresses.CollateralHealthReader.toLowerCase() === m.CollateralHealthReader.toLowerCase()
    && viem.keccak256(await network.client.getCode({ address: m.CollateralHealthReader })) === readerHash) {
    if (await network.read("TermbookCore", m.TermbookCore, "healthMaxAge") > age) throw new Error("Health state freshness changed");
    log(JSON.stringify({ configured: true, step: operation }));
    return;
  }
  const previousReader = m.CollateralHealthReader;
  const markets = [
    { chain: 11155111n, asset: deployment.tokens[11155111].WETH },
    ...deployment.configuration.native ? [{ chain: 10143n, asset: deployment.configuration.native.asset }] : [],
    ...deployment.configuration.solana ? [{ chain: BigInt(deployment.configuration.solana.sourceChain), asset: deployment.configuration.solana.asset }] : [],
  ];
  const houses = new Set([m.HouseVault, deployment.configuration["kuru-integration"]?.vault].filter(Boolean));
  for (const house of houses) for (const field of ["drawnPrincipal", "accruedReceivables", "committedCash", "unresolvedCreditImpairment"]) {
    if (await network.read("HouseVault", house, field) !== 0n) throw new Error("Close test facilities before replacing health readers");
  }
  const settlement = deployment.tokens[10143].USDC;
  const copies = [];
  for (const market of markets) {
    const id = await network.read("CollateralHealthReader", previousReader, "marketId", [market.chain, market.asset, settlement]);
    const [priceId,,, retained, decimals,, costs, active] = await network.read("CollateralHealthReader", previousReader, "markets", [id]);
    if (!active) throw new Error("Expected collateral market is not admitted");
    copies.push([market.chain, market.asset, settlement, priceId, decimals, retained, costs]);
  }
  const planHash = viem.keccak256(viem.toHex(JSON.stringify({ core: m.TermbookCore, previousReader,
    previousCodeHash: viem.keccak256(await network.client.getCode({ address: previousReader })),
    source: m.HealthSource, factory: m.AppHealthReaderFactory, readerHash, age, copies }, (_, value) => typeof value === "bigint" ? String(value) : value)));
  if (report.planHash && report.planHash !== planHash) throw new Error("Health freshness plan changed");
  report.planHash = planHash; persist();
  if (!simulate) {
    const plan = JSON.parse(fs.readFileSync(operationFile(`${operation}-simulation`), "utf8"));
    if (!plan.completedAt || plan.planHash !== planHash || Date.now() - Date.parse(plan.completedAt) > 3_600_000) {
      throw new Error("Matching recent health freshness simulation required");
    }
    const remaining = plan.transactions.filter((tx) => !report.transactions.some((sent) => sent.name === tx.name && sent.status === "success"));
    const gasPrice = await network.client.getGasPrice();
    const budget = remaining.reduce((sum, tx) => sum + BigInt(tx.gasLimit), 0n) * (gasPrice < 100_000_000_000n ? 100_000_000_000n : gasPrice) * 11n / 10n;
    if (await network.client.getBalance({ address: deployment.deployer }) < budget + viem.parseEther("0.01")) throw new Error(`Health setup requires ${viem.formatEther(budget)} test MON`);
  }
  const ratio = deployment.configuration.setup.addresses.RatioPriceFeed;
  const base = await network.read("OracleRegistry", m.OracleRegistry, "read", [deployment.configuration.setup.feeds.ETH.id]);
  const quote = await network.read("OracleRegistry", m.OracleRegistry, "read", [deployment.configuration.setup.feeds.USDC.id]);
  if (await network.read("RatioPriceFeed", ratio, "baseRound") !== base[2]
    || await network.read("RatioPriceFeed", ratio, "quoteRound") !== quote[2]) {
    await network.call("RatioPriceFeed", ratio, "update", [], `health-ratio:${base[2]}:${quote[2]}`);
  }
  for (const args of copies) await network.read("OracleRegistry", m.OracleRegistry, "read", [args[3]]);
  const reader = await network.deploy("CollateralHealthReader", [m.TermbookCore, m.ProtocolGovernance, m.OracleRegistry]);
  for (const args of copies) {
    await network.govern("CollateralHealthReader", reader, "setMarket", args);
    const id = await network.read("CollateralHealthReader", reader, "marketId", args.slice(0, 3));
    const oldId = await network.read("CollateralHealthReader", previousReader, "marketId", args.slice(0, 3));
    if (JSON.stringify(await network.read("CollateralHealthReader", reader, "markets", [id]), (_, value) => typeof value === "bigint" ? String(value) : value)
      !== JSON.stringify(await network.read("CollateralHealthReader", previousReader, "markets", [oldId]), (_, value) => typeof value === "bigint" ? String(value) : value)) throw new Error("Collateral market copy mismatch");
  }
  const factory = await network.deploy("AppHealthReaderFactory", [m.TermbookCore, reader]);
  if ((await network.read("AppHealthReaderFactory", factory, "collateralReader")).toLowerCase() !== reader.toLowerCase()
    || (await network.read("AppHealthReaderFactory", factory, "core")).toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Health factory binding mismatch");
  if (await network.read("TermbookCore", m.TermbookCore, "healthMaxAge") > age) {
    await network.govern("TermbookCore", m.TermbookCore, "setHealthMaxAge", [age]);
  }
  const next = globalThis.structuredClone(deployment);
  next.addresses[10143].CollateralHealthReader = reader;
  next.addresses[10143].AppHealthReaderFactory = factory;
  report.completedAt = new Date().toISOString();
  report.stateMaxAgeSeconds = Number(age); report.readerCodeHash = readerHash;
  persist();
  if (simulate) {
    next.configuration[operation] = { core: m.TermbookCore, completedAt: report.completedAt, addresses: report.addresses,
      stateMaxAgeSeconds: Number(age), readerCodeHash: readerHash };
    writeJsonAtomic(operationFile(`${operation}-manifest`), next);
  } else {
    writeJsonAtomic(path.join(root, "deployments/testnet.json"), next);
    writeConfiguration(operation, { completedAt: report.completedAt, planHash, stateMaxAgeSeconds: Number(age),
      readerCodeHash: readerHash, previousReader, previousFactory: m.AppHealthReaderFactory,
      addresses: report.addresses, transactions: report.transactions });
    const file = path.join(root, ".env"), env = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, env.replace(/^SHARED_HEALTH_FACTORY=.*\n?/m, "").replace(/^SHARED_COLLATERAL_READER=.*\n?/m, "")
      + `\nSHARED_HEALTH_FACTORY=${factory}\nSHARED_COLLATERAL_READER=${reader}\n`, { mode: 0o600 });
    clearOperation(operation);
  }
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, step: operation, stateMaxAgeSeconds: Number(age),
    transactions: report.transactions.length, costMON: viem.formatEther(cost) }));
}

async function setupFreshPrices() {
  if (!simulate && alreadyConfigured("fresh-prices")) { clearOperation("fresh-prices"); log(JSON.stringify({ configured: true, step: "fresh-prices" })); return; }
  const { preparePythUpdates, pythAbi, pythEndpoint } = await import("../server/dist/chain/pyth.client.js");
  const runtime = await testnetRuntime("fresh-prices", simulate);
  const { deployment, report, persist } = runtime;
  const network = await runtime.context(10143), m = deployment.addresses[10143];
  const { artifact } = await import("./testnet-runtime.mjs");
  if (viem.keccak256(await network.client.getCode({ address: await network.read("TestnetProxy", m.OracleRegistry, "proxyImplementation") }))
    !== viem.keccak256(artifact("OracleRegistry").deployedBytecode.object)) throw new Error("Upgrade OracleRegistry before migrating feeds");
  const pyth = deployment.configuration.native?.pyth;
  if (!pyth || !process.env["PYTH_API_KEY"]) throw new Error("Configure PYTH_API_KEY and native MON pricing first");
  const houses = new Set([m.HouseVault, deployment.configuration["kuru-integration"]?.vault].filter(Boolean));
  for (const house of houses) for (const field of ["drawnPrincipal", "accruedReceivables", "committedCash", "unresolvedCreditImpairment"]) {
    if (await network.read("HouseVault", house, field) !== 0n) throw new Error("Close existing test facilities before migrating prices");
  }
  const items = [
    { name: "MON", id: deployment.configuration.native.pythId, confidence: 200 },
    { name: "USDC", id: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", confidence: 50 },
    { name: "ETH", id: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", confidence: 200 },
    ...(deployment.configuration.solana ? [{ name: "SOL", id: deployment.configuration.solana.pythId, confidence: 200 }] : []),
  ];
  const source = { address: pyth, codeHash: viem.keccak256(await network.client.getCode({ address: pyth })),
    maximumUpdateFee: 1_000_000_000_000n, feeds: items.map((item) => ({ id: item.id, maxAgeSeconds: 300, refreshAgeSeconds: 60, maxConfidenceBps: item.confidence })) };
  const planHash = viem.keccak256(viem.toHex(JSON.stringify({ core: m.TermbookCore, source,
    registryCodeHash: viem.keccak256(artifact("OracleRegistry").deployedBytecode.object) }, (_, value) => typeof value === "bigint" ? String(value) : value)));
  if (report.planHash && report.planHash !== planHash) throw new Error("Fresh pricing plan changed");
  report.planHash = planHash; persist();
  if (!simulate) {
    const plan = JSON.parse(fs.readFileSync(operationFile("fresh-prices-simulation"), "utf8"));
    if (!plan.completedAt || plan.planHash !== planHash) throw new Error("Matching fresh pricing simulation required");
    const remaining = plan.transactions.filter((tx) => !report.transactions.some((sent) => sent.name === tx.name && sent.status === "success"));
    const gasPrice = await network.client.getGasPrice();
    const budget = remaining.reduce((sum, tx) => sum + BigInt(tx.gasLimit), 0n) * (gasPrice < 100_000_000_000n ? 100_000_000_000n : gasPrice) * 11n / 10n;
    if (await network.client.getBalance({ address: deployment.deployer }) < budget + viem.parseEther("0.01")) throw new Error(`Fresh pricing requires ${viem.formatEther(budget)} test MON`);
  }
  const config = { sources: [source], account: { address: deployment.deployer }, apiKey: process.env["PYTH_API_KEY"],
    endpoint: pythEndpoint() };
  const update = await preparePythUpdates(network.client, config, source);
  await network.send(`publish-prices:${update.prices.map((price) => price.price.publishTime).join(":")}`,
    viem.encodeFunctionData({ abi: pythAbi, functionName: "updatePriceFeeds", args: [update.updates] }), pyth, update.fee);
  report.expectedFeeds ??= {};
  for (const name of ["USDC", "ETH"]) {
    const id = deployment.configuration.setup.feeds[name].id;
    report.expectedFeeds[name] ??= await network.read("OracleRegistry", m.OracleRegistry, "feeds", [id]); persist();
    const item = items.find((item) => item.name === name);
    const address = await network.deploy("PythPriceFeed", [pyth, item.id, 300n, BigInt(item.confidence)], `${name}PriceFeed`);
    await network.govern("OracleRegistry", m.OracleRegistry, "replaceFeed", [id, report.expectedFeeds[name], address, 300n, 18, viem.zeroAddress]);
  }
  const setup = deployment.configuration.setup;
  report.expectedFeeds.ratio ??= await network.read("OracleRegistry", m.OracleRegistry, "feeds", [setup.priceId]); persist();
  const ratio = await network.deploy("LiveRatioPriceFeed", [m.OracleRegistry, setup.feeds.ETH.id, setup.feeds.USDC.id], "ETHLiveRatioPriceFeed");
  const ratioGuard = await network.deploy("CodeHashGuard", [ratio], "ETHRatioGuard");
  await network.govern("OracleRegistry", m.OracleRegistry, "replaceFeed", [setup.priceId, report.expectedFeeds.ratio, ratio, 300n, 18, ratioGuard]);
  for (const item of [deployment.configuration.native, deployment.configuration.solana].filter(Boolean)) {
    if (await network.read("OracleRegistry", m.OracleRegistry, "maxAge", [item.priceId]) > 300n) {
      await network.govern("OracleRegistry", m.OracleRegistry, "tightenFeedAge", [item.priceId, 300n]);
    }
  }
  await network.govern("TermbookCore", m.TermbookCore, "setHealthMaxAge", [300n]);
  const implementation = await network.read("TestnetProxy", m.OracleRegistry, "proxyImplementation");
  const oracleGuard = await network.deploy("ImplementationGuard", [m.OracleRegistry, implementation, viem.toFunctionSelector("proxyImplementation()")], "FreshOracleGuard");
  const prices = {};
  for (const item of items) {
    const id = viem.keccak256(viem.stringToHex(`testnet:${item.name}/USD`));
    const price = await network.read("OracleRegistry", m.OracleRegistry, "read", [id]);
    prices[item.name] = price.map(String);
    if (await network.read("OracleRegistry", m.OracleRegistry, "maxAge", [id]) !== 300n) throw new Error("Fresh feed age mismatch");
  }
  report.completedAt = new Date().toISOString(); persist();
  if (!simulate) {
    for (const name of ["USDC", "ETH"]) setup.feeds[name] = { id: setup.feeds[name].id, address: report.addresses[`${name}PriceFeed`],
      kind: "pyth", pythId: items.find((item) => item.name === name).id, maxAgeSeconds: 300 };
    setup.addresses.RatioPriceFeed = ratio;
    setup.maxAgeSeconds = 300;
    deployment.configuration["kuru-market"].oracleGuard = { address: oracleGuard, proxy: m.OracleRegistry, implementation,
      codeHash: viem.keccak256(await network.client.getCode({ address: oracleGuard })) };
    deployment.configuration["fresh-prices"] = { core: m.TermbookCore, completedAt: report.completedAt, addresses: report.addresses,
      maxAgeSeconds: 300, refreshAgeSeconds: 60, provider: pyth, providerCodeHash: source.codeHash, priceIds: items,
      previousFeeds: report.expectedFeeds, prices };
    const { writeJsonAtomic } = await import("./testnet-state.mjs");
    writeJsonAtomic(path.join(root, "deployments/testnet.json"), deployment);
    const file = path.join(root, ".env");
    let env = fs.readFileSync(file, "utf8");
    env = env.replace(/^PYTH_PRICE_FEEDS=.*\n?/m, "").replace(/^RATIO_PRICE_FEEDS=.*\n?/m, "");
    env += `PYTH_PRICE_FEEDS=${JSON.stringify([{ ...source, maximumUpdateFee: String(source.maximumUpdateFee) }])}\nRATIO_PRICE_FEEDS=[]\n`;
    fs.writeFileSync(file, env, { mode: 0o600 });
    clearOperation("fresh-prices");
  }
  log(JSON.stringify({ simulated: simulate, step: "fresh-prices", maxAgeSeconds: 300, transactions: report.transactions.length,
    costMON: viem.formatEther(report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n)) }));
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
