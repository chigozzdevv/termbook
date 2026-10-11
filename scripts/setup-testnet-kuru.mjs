import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { createRequire } from "node:module";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";
import { writeConfiguration, clearOperation, operationFile } from "./testnet-state.mjs";
import { proxyImplementationSlots, proxyBeaconSlot, resolveProxyImplementation } from "../packages/schema/dist/index.js";

const simulate = process.argv.includes("--simulate");
const configure = process.argv.includes("--configure");
const reviewRuntime = process.argv.includes("--review-runtime");
const liquidity = process.argv.includes("--liquidity");
if ([configure, reviewRuntime, liquidity].filter(Boolean).length > 1 || simulate === process.argv.includes("--broadcast") || process.argv.length !== (configure || reviewRuntime || liquidity ? 4 : 3)
  || process.argv.slice(2).some((a) => !["--simulate", "--broadcast", "--configure", "--review-runtime", "--liquidity"].includes(a))) throw new Error("Use --simulate or --broadcast, optionally with --configure, --review-runtime or --liquidity");
const operation = liquidity ? "kuru-liquidity" : configure ? "kuru-integration" : reviewRuntime ? "kuru-runtime-review" : "kuru-setup";
const factory = "0x7EFbE105Ca7415dE98F96622173458ac1c054630";
const factoryAbi = viem.parseAbi([
  "function deployProxy(uint8,address,address,uint96,uint32,uint32,uint96,uint96,uint256,uint256,uint96) returns(address)",
  "function orderBookImplementation() view returns(address)", "function marginAccountAddress() view returns(address)",
  "function TRUSTED_FORWARDER() view returns(address)",
]);
const marketAbi = viem.parseAbi([
  "function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
  "function kuruAmmVault() view returns(address)", "function addBuyOrder(uint32,uint96,bool)",
  "function addSellOrder(uint32,uint96,bool)", "function s_orderIdCounter() view returns(uint40)",
  "function getL2Book(uint32,uint32) view returns(bytes)",
  "function s_orders(uint40) view returns(address,uint96,uint40,uint40,uint40,uint32,uint32,bool)",
  "function batchCancelOrders(uint40[])",
]);
const tokenAbi = viem.parseAbi(["function approve(address,uint256) returns(bool)"]);
const marginAbi = viem.parseAbi(["function deposit(address,address,uint256) payable"]);
const require = createRequire(path.join(root, "packages/sdk/package.json"));
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

async function main() {
  const runtime = await testnetRuntime(operation, simulate);
  const { deployment, report, persist } = runtime;
  const network = await runtime.context(10143);
  const m = deployment.addresses[10143];
  const setup = deployment.configuration.native;
  if (!setup || setup.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Admit native MON prices first");
  const usdc = deployment.tokens[10143].USDC;
  if (liquidity) {
    const installed = deployment.configuration["kuru-market"];
    if (!installed || installed.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Current Kuru market required");
    const market = installed.market;
    const params = await network.client.readContract({ address: market, abi: marketAbi, functionName: "getMarketParams" });
    if (params[2] !== viem.zeroAddress || params[4].toLowerCase() !== usdc.toLowerCase() || params[3] !== 18n || params[5] !== 6n) throw new Error("Maker market assets changed");
    const price = await network.read("OracleRegistry", m.OracleRegistry, "read", [setup.priceId]);
    const tick = BigInt(params[6]), precision = BigInt(params[0]);
    if (!simulate && !report.orderIds) {
      const plan = JSON.parse(fs.readFileSync(operationFile(`${operation}-simulation`), "utf8"));
      if (!plan.completedAt) throw new Error("Liquidity simulation required");
      for (const id of plan.orderIds) {
        const order = await network.client.readContract({ address: market, abi: marketAbi, functionName: "s_orders", args: [BigInt(id)] });
        if (order[0].toLowerCase() !== deployment.deployer.toLowerCase() || order[1] === 0n) throw new Error("Simulated maker order changed");
      }
      for (const field of ["orderIds", "reference", "bid", "ask", "size"]) report[field] = plan[field];
      persist();
    }
    if (!report.orderIds) {
      const count = await network.client.readContract({ address: market, abi: marketAbi, functionName: "s_orderIdCounter" });
      if (count > 100n) throw new Error("Maker order scan limit exceeded");
      report.orderIds = [];
      for (let id = 1n; id <= count; id++) {
        const order = await network.client.readContract({ address: market, abi: marketAbi, functionName: "s_orders", args: [id] });
        if (order[0].toLowerCase() === deployment.deployer.toLowerCase() && order[1] > 0n) report.orderIds.push(String(id));
      }
      report.reference = String(price[0]);
      report.bid = String(price[0] * precision * 9950n / 10n ** 18n / 10_000n / tick * tick);
      report.ask = String((price[0] * precision * 10050n / 10n ** 18n / 10_000n + tick - 1n) / tick * tick);
      report.size = String(params[1]); persist();
    }
    const difference = price[0] > BigInt(report.reference) ? price[0] - BigInt(report.reference) : BigInt(report.reference) - price[0];
    if (difference * 10_000n > BigInt(report.reference) * 25n) throw new Error("Maker reference moved; reconcile the liquidity plan before repricing");
    if (!simulate) {
      const plan = JSON.parse(fs.readFileSync(operationFile(`${operation}-simulation`), "utf8"));
      if (!plan.completedAt || plan.bid !== report.bid || plan.ask !== report.ask || JSON.stringify(plan.orderIds) !== JSON.stringify(report.orderIds)) throw new Error("Matching liquidity simulation required");
    }
    const ids = report.orderIds.map(BigInt);
    if (ids.length) await network.send("cancel-owned-maker-orders", viem.encodeFunctionData({ abi: marketAbi, functionName: "batchCancelOrders", args: [ids] }), market);
    await network.send("refresh-maker-bid", viem.encodeFunctionData({ abi: marketAbi, functionName: "addBuyOrder", args: [Number(report.bid), BigInt(report.size), true] }), market);
    await network.send("refresh-maker-ask", viem.encodeFunctionData({ abi: marketAbi, functionName: "addSellOrder", args: [Number(report.ask), BigInt(report.size), true] }), market);
    report.completedAt ??= new Date().toISOString(); persist();
    if (!simulate) { installed.bid = report.bid; installed.ask = report.ask; installed.liquidityUpdatedAt = report.completedAt;
      const { writeJsonAtomic } = await import("./testnet-state.mjs");
      writeJsonAtomic(path.join(root, "deployments/testnet.json"), deployment); clearOperation(operation); }
    log(JSON.stringify({ simulated: simulate, market, bid: report.bid, ask: report.ask,
      costMON: viem.formatEther(report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n)) }));
    return;
  }
  if (reviewRuntime) {
    const { runtimeReviewData, runtimeReviewSummary } = await import("../packages/sdk/dist/index.js");
    const { runtimeReviewSchema } = await import("../packages/schema/dist/index.js");
    const market = deployment.configuration["kuru-market"];
    const pin = market?.dependencies.find((p) => p.address.toLowerCase() === market.market.toLowerCase());
    if (!pin?.implementation || !pin.guard || market.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Kuru monitor and deployment binding required");
    const block = await network.client.getBlock({ blockTag: "finalized" });
    const [live, code, governance] = await Promise.all([
      network.client.getStorageAt({ address: market.market, slot: pin.implementationSlot, blockNumber: block.number }),
      network.client.getCode({ address: pin.implementation, blockNumber: block.number }),
      network.read("ProtocolGovernance", m.ProtocolGovernance, "governance"),
    ]);
    if (viem.getAddress(`0x${live.slice(-40)}`) !== viem.getAddress(pin.implementation)
      || viem.keccak256(code) !== pin.implementationCodeHash || governance.toLowerCase() !== deployment.deployer.toLowerCase()) throw new Error("Kuru runtime review pin changed");
    const now = Math.floor(Date.now() / 1000);
    const review = runtimeReviewSchema.parse({ chain_id: 10143, core: m.TermbookCore, target: market.market,
      implementation: pin.implementation, code_hash: pin.implementationCodeHash, maximum_input: "100000",
      approved_at: now, expires_at: now + 7 * 86400, reviewer: deployment.deployer, signature: `0x${"00".repeat(65)}`,
      abi: ["function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
        "function marketState() view returns(uint8)", "function isTrustedForwarder(address) view returns(bool)",
        "function kuruAmmVault() view returns(address)",
        "function placeAndExecuteMarketBuy(uint96,uint256,bool,bool) payable returns(uint256)",
        "function placeAndExecuteMarketSell(uint96,uint256,bool,bool) payable returns(uint256)",
        "function addBuyOrder(uint32,uint96,bool)", "function addSellOrder(uint32,uint96,bool)",
        "function batchCancelOrders(uint40[])", "function s_orderIdCounter() view returns(uint40)",
        "function s_orders(uint40) view returns(address,uint96,uint40,uint40,uint40,uint32,uint32,bool)",
        "function s_buyPricePoints(uint256) view returns(uint40,uint40)",
        "function s_sellPricePoints(uint256) view returns(uint40,uint40)"] });
    if (!simulate) {
      review.signature = await runtime.account.signTypedData(runtimeReviewData(review));
      const file = path.join(root, ".env");
      const env = fs.readFileSync(file, "utf8");
      const current = JSON.parse(env.match(/^TESTNET_RUNTIME_REVIEWS=(.+)$/m)?.[1] ?? "[]");
      if (!Array.isArray(current)) throw new Error("Invalid existing runtime reviews");
      const reviews = [...current.filter((r) => r.target.toLowerCase() !== review.target.toLowerCase()), review];
      const guards = JSON.parse(env.match(/^TESTNET_UPGRADE_GUARDS=(.+)$/m)?.[1] ?? "[]");
      const guard = guards.find((g) => g.address.toLowerCase() === pin.guard.toLowerCase());
      if (!guard) throw new Error("Runtime review monitor is not configured");
      guard.runtimeReview = runtimeReviewSummary(review).id;
      const updated = env.replace(/^TESTNET_RUNTIME_REVIEWS=.*\n?/m, "").replace(/^TESTNET_UPGRADE_GUARDS=.*\n?/m, "");
      fs.writeFileSync(file, `${updated}${updated.endsWith("\n") ? "" : "\n"}TESTNET_RUNTIME_REVIEWS=${JSON.stringify(reviews)}\nTESTNET_UPGRADE_GUARDS=${JSON.stringify(guards)}\n`, { mode: 0o600 });
      writeConfiguration("kuru-runtime-review", { review, summary: runtimeReviewSummary(review),
        trustModel: "Testnet operator-approved bytecode; source build unverified; expiring RPC upgrade monitor" });
    }
    clearOperation(operation, simulate);
    log(JSON.stringify({ simulated: simulate, reviewed: market.market, implementation: pin.implementation,
      expiresAt: review.expires_at, maximumInput: review.maximum_input, sourceVerified: false }));
    return;
  }
  if (configure) {
    const { create_kuru } = await import("../server/dist/kuru/integration.js");
    const { prepare_atomic_spot, prepare_use_case, use_case_configuration, package_integration, atomic_configuration } = await import("../packages/sdk/dist/index.js");
    const market = deployment.configuration["kuru-market"];
    if (!market || market.core.toLowerCase() !== m.TermbookCore.toLowerCase()
      || !market.oracleGuard || market.dependencies.length !== 6 || market.dependencies.some((p) => !market.guards[p.address])) throw new Error("Complete the Kuru dependency and Oracle guards first");
    if (simulate) {
      await network.client.request({ method: "anvil_setBlockTimestampInterval", params: [1] });
      await network.client.request({ method: "anvil_impersonateAccount", params: [market.monitor] });
      await network.client.request({ method: "anvil_setBalance", params: [market.monitor, viem.toHex(viem.parseEther("1000"))] });
      const wallet = viem.createWalletClient({ account: market.monitor,
        transport: viem.http(process.env["TERMBOOK_SIMULATION_MONAD_RPC"] ?? "http://127.0.0.1:18545") });
      for (const guard of Object.values(market.guards)) {
        const latest = await network.client.getBlock();
        await network.client.request({ method: "evm_setNextBlockTimestamp", params: [Number(latest.timestamp) + 1] });
        await network.client.request({ method: "evm_mine", params: [] });
        const block = await network.client.getBlock({ blockTag: "latest" });
        const hash = await wallet.writeContract({ chain: null, address: guard.address,
          abi: viem.parseAbi(["function renew(uint64,bytes32,uint64)"]), functionName: "renew",
          args: [block.number, block.hash, block.timestamp], gasPrice: 100_000_000_000n });
        if ((await network.client.waitForTransactionReceipt({ hash })).status !== "success") throw new Error("Simulated Kuru monitor renewal failed");
      }
    }
    let definitionClient = network.client, sourceBlock;
    if (simulate) {
      const { forkConfig } = await network.client.request({ method: "anvil_nodeInfo", params: [] });
      if (!forkConfig?.forkUrl || !Number.isSafeInteger(forkConfig.forkBlockNumber)) throw new Error("Configuration simulation requires a pinned fork");
      const source = viem.createPublicClient({ transport: viem.http(forkConfig.forkUrl, { timeout: 30_000 }) });
      sourceBlock = await source.getBlock({ blockNumber: BigInt(forkConfig.forkBlockNumber) });
      if (sourceBlock.hash !== (await network.client.getBlock({ blockNumber: sourceBlock.number })).hash) throw new Error("Configuration fork is not canonical");
      definitionClient = source.extend((client) => ({
        getBlock: () => client.getBlock({ blockNumber: sourceBlock.number }),
        readContract: (request) => client.readContract({ ...request, blockTag: undefined, blockNumber: sourceBlock.number }),
        getBytecode: (request) => client.getBytecode({ ...request, blockTag: undefined, blockNumber: sourceBlock.number }),
        getStorageAt: (request) => client.getStorageAt({ ...request, blockTag: undefined, blockNumber: sourceBlock.number }),
      }));
    }
    const plugin = await create_kuru({ client: definitionClient, market_address: market.market, settlement_asset: usdc,
      api_base: process.env["TERMBOOK_PUBLIC_API_BASE"] ?? "http://127.0.0.1:3002", maximum_input: 100_000n,
      retained_bps: 9_500, recovery_costs: 1000n, max_holding: viem.parseEther("1"), dust_limit: 10_000_000_000n,
      oracle: m.OracleRegistry, feed_id: setup.priceId });
    const identity = package_integration(plugin);
    if (report.versionId && report.versionId !== identity.version_id) throw new Error("Kuru configuration changed; reconcile the pending operation");
    report.versionId = identity.version_id; report.definitionHash = identity.hash; persist();
    const plan = await (plugin.definition.assessment ? prepare_use_case : prepare_atomic_spot)(plugin.definition, { client: definitionClient, registry: m.IntegrationRegistry,
      core: m.TermbookCore, health_source: m.HealthSource, health_factory: m.AppHealthReaderFactory,
      guards: { ...Object.fromEntries(Object.entries(market.guards).map(([target, pin]) => [target, pin.address])),
        [m.OracleRegistry.toLowerCase()]: market.oracleGuard?.address },
      max_slippage_bps: 100, max_deviation_bps: 500, max_authorization_age: 90, max_state_age: 90,
      max_health_age: Number(deployment.configuration.setup.maxAgeSeconds) });
    if (sourceBlock && (await definitionClient.getBlock()).hash !== sourceBlock.hash) throw new Error("Configuration source block changed");
    const planHash = viem.keccak256(viem.toHex(JSON.stringify(plan.calls, (_, value) => typeof value === "bigint" ? String(value) : value)));
    if (report.planHash && report.planHash !== planHash) throw new Error("Kuru governance plan changed");
    report.planHash = planHash; persist();
    if (!simulate) {
      const simulation = JSON.parse(fs.readFileSync(operationFile(`${operation}-simulation`), "utf8"));
      if (!simulation.completedAt || simulation.planHash !== planHash || simulation.versionId !== identity.version_id) throw new Error("Simulate this Kuru configuration first");
      const remaining = simulation.transactions.filter((tx) => !report.transactions.some((sent) => sent.name === tx.name && sent.status === "success"));
      const price = await network.client.getGasPrice();
      const budget = remaining.reduce((gas, tx) => gas + BigInt(tx.gasLimit), 0n) * (price < 100_000_000_000n ? 100_000_000_000n : price) * 11n / 10n;
      if (await network.client.getBalance({ address: deployment.deployer }) < budget + viem.parseEther("0.01")) throw new Error(`Kuru configuration requires ${viem.formatEther(budget)} test MON`);
    }
    const existingFeedGuard = await network.read("OracleRegistry", m.OracleRegistry, "feedGuards", [setup.priceId]);
    if (existingFeedGuard === viem.zeroAddress) {
      const feed = await network.read("OracleRegistry", m.OracleRegistry, "feeds", [setup.priceId]);
      const guard = await network.deploy("CodeHashGuard", [feed], "KuruPriceFeedGuard");
      await network.govern("OracleRegistry", m.OracleRegistry, "setFeedGuard", [setup.priceId, guard]);
    }
    for (const call of plan.calls) {
      if (call.value !== 0n) throw new Error("Unexpected Kuru governance payment");
      await network.governData(call.target, call.data, { description: call.description });
    }
    const config = plugin.definition.assessment ? use_case_configuration(plugin.definition) : atomic_configuration(plugin.definition);
    const checkedTarget = plugin.definition.assessment ? plugin.definition.contracts.reader : config.config.module;
    const checkedHash = plugin.definition.assessment ? config.reader_hash : config.configuration_hash;
    if (await network.client.readContract({ address: checkedTarget, abi: viem.parseAbi(["function configurationHashes(bytes32) view returns(bytes32)"]),
      functionName: "configurationHashes", args: [identity.version_id] }) !== checkedHash
      || !await network.read("IntegrationRegistry", m.IntegrationRegistry, "isActive", [identity.version_id])) throw new Error("Kuru configuration verification failed");
    report.completedAt = new Date().toISOString(); persist();
    if (!simulate) {
      writeConfiguration("kuru-integration", { core: m.TermbookCore, bundleId: identity.version_id, codeHash: identity.hash,
        definition: plugin.definition, healthReader: plan.health_reader, planHash, completedAt: report.completedAt });
      clearOperation(operation, false);
    }
    log(JSON.stringify({ simulated: simulate, configured: true, bundleId: identity.version_id,
      transactions: report.transactions.length, admission: "requires SDK lifecycle validation" }));
    return;
  }
  const keyFile = path.join(root, ".testnet/upgrade-monitor.json");
  const stored = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, "utf8")) : undefined;
  const key = stored?.privateKey ?? generatePrivateKey();
  const monitor = privateKeyToAccount(key);
  if (stored && stored.address.toLowerCase() !== monitor.address.toLowerCase()) throw new Error("Monitor wallet mismatch");
  if (!stored) fs.writeFileSync(keyFile, JSON.stringify({ address: monitor.address, privateKey: key }) + "\n", { mode: 0o600, flag: "wx" });
  const prior = deployment.configuration["kuru-market"];
  if (prior && prior.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Kuru setup belongs to another Core");
  const args = [1, viem.zeroAddress, usdc, 10_000_000_000n, 100_000_000, 100, 10_000_000n, 1_000_000_000_000n, 0n, 0n, 100n];
  const factoryHash = viem.keccak256(await network.client.getCode({ address: factory }));
  if (factoryHash !== "0xae572ec3ca9b5f49c0364ca34edc5880b6b2837e47802e64e6b681bf2e74aa5c") throw new Error("Kuru factory code changed");
  if (!prior && !report.market) {
    const request = await network.client.simulateContract({ address: factory, abi: factoryAbi,
      functionName: "deployProxy", args, account: deployment.deployer });
    report.market = request.result;
    persist();
  }
  const market = prior?.market ?? report.market;
  if (!await network.client.getCode({ address: market })) {
    await network.send("create-MON-USDC-market", viem.encodeFunctionData({ abi: factoryAbi, functionName: "deployProxy", args }), factory);
  }
  const read = (address, abi, functionName, args = []) => network.client.readContract({ address, abi, functionName, args });
  const params = await read(market, marketAbi, "getMarketParams");
  if (params[0] !== args[4] || params[1] !== args[3] || params[2] !== viem.zeroAddress || params[3] !== 18n
    || params[4].toLowerCase() !== usdc.toLowerCase() || params[5] !== 6n || params[6] !== args[5]
    || params[7] !== args[6] || params[8] !== args[7] || params[9] !== 0n || params[10] !== 0n) throw new Error("Kuru market parameters mismatch");
  const [vault, margin, forwarder] = await Promise.all([
    read(market, marketAbi, "kuruAmmVault"), read(factory, factoryAbi, "marginAccountAddress"), read(factory, factoryAbi, "TRUSTED_FORWARDER"),
  ]);
  if (!prior) {
    const price = await network.read("OracleRegistry", m.OracleRegistry, "read", [setup.priceId]);
    const tick = 100n, precision = 100_000_000n;
    report.bid ??= String(price[0] * precision * 9950n / 10n ** 18n / 10_000n / tick * tick);
    report.ask ??= String((price[0] * precision * 10050n / 10n ** 18n / 10_000n + tick - 1n) / tick * tick);
    persist();
    const bid = BigInt(report.bid), ask = BigInt(report.ask);
    if (bid <= 0n || bid >= ask || ask >= 2n ** 32n) throw new Error("Invalid Kuru liquidity prices");
    const size = viem.parseEther("1") * params[1] / 10n ** 18n;
    await network.send("approve-maker-USDC", viem.encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [margin, 1_000_000n] }), usdc);
    await network.send("fund-maker-USDC", viem.encodeFunctionData({ abi: marginAbi, functionName: "deposit", args: [deployment.deployer, usdc, 1_000_000n] }), margin);
    await network.send("fund-maker-MON", viem.encodeFunctionData({ abi: marginAbi, functionName: "deposit", args: [deployment.deployer, viem.zeroAddress, viem.parseEther("1")] }), margin, viem.parseEther("1"));
    await network.send("maker-bid", viem.encodeFunctionData({ abi: marketAbi, functionName: "addBuyOrder", args: [Number(bid), size, true] }), market);
    await network.send("maker-ask", viem.encodeFunctionData({ abi: marketAbi, functionName: "addSellOrder", args: [Number(ask), size, true] }), market);
  }
  const guards = { ...prior?.guards };
  const dependencies = [];
  for (const address of [...new Set([market, factory, vault, margin, forwarder, usdc].map((a) => a.toLowerCase()))]) {
    const codeHash = viem.keccak256(await network.client.getCode({ address }));
    const block = await network.client.getBlock({ blockTag: "finalized" });
    const words = await Promise.all([...proxyImplementationSlots, proxyBeaconSlot]
      .map((slot) => network.client.getStorageAt({ address, slot, blockNumber: block.number })));
    const proxy = resolveProxyImplementation(words.slice(0, -1), words.at(-1));
    const implementation = proxy ? viem.getAddress(proxy.implementation) : viem.zeroAddress;
    if (implementation !== viem.zeroAddress) {
      let guard = guards[address];
      if (!guard) {
        const deployed = await network.deploy("TestnetUpgradeGuard", [address, implementation, monitor.address, m.ProtocolGovernance], `KuruGuard-${address}`);
        guard = guards[address] = { address: deployed, codeHash: viem.keccak256(await network.client.getCode({ address: deployed })) };
      }
      if ((await network.read("TestnetUpgradeGuard", guard.address, "proxy")).toLowerCase() !== address
        || (await network.read("TestnetUpgradeGuard", guard.address, "implementation")).toLowerCase() !== implementation.toLowerCase()
        || (await network.read("TestnetUpgradeGuard", guard.address, "monitor")).toLowerCase() !== monitor.address.toLowerCase()
        || viem.keccak256(await network.client.getCode({ address: guard.address })) !== guard.codeHash) throw new Error("Kuru monitor binding mismatch");
    }
    dependencies.push({ address, codeHash, ...(implementation !== viem.zeroAddress ? { implementation,
      implementationSlot: proxy.slot, implementationCodeHash: viem.keccak256(await network.client.getCode({ address: implementation })), guard: guards[address].address } : {}) });
  }
  const oracleImplementation = await network.read("TestnetProxy", m.OracleRegistry, "proxyImplementation");
  if (oracleImplementation.toLowerCase() !== deployment.proxies[10143].OracleRegistry.implementation.toLowerCase()) throw new Error("Oracle implementation changed");
  const oracleGuardAddress = prior?.oracleGuard?.address ?? await network.deploy("ImplementationGuard", [m.OracleRegistry,
    oracleImplementation, viem.toFunctionSelector("proxyImplementation()")], "KuruOracleGuard");
  if (!await network.read("ImplementationGuard", oracleGuardAddress, "valid", [m.OracleRegistry])) throw new Error("Oracle guard is invalid");
  const oracleGuard = { address: oracleGuardAddress, codeHash: viem.keccak256(await network.client.getCode({ address: oracleGuardAddress })),
    proxy: m.OracleRegistry, implementation: oracleImplementation };
  if (prior?.oracleGuard && oracleGuard.codeHash !== prior.oracleGuard.codeHash) throw new Error("Oracle guard code changed");
  if (!simulate) {
    const file = path.join(root, ".env");
    let env = fs.readFileSync(file, "utf8");
    for (const [name, value] of Object.entries({ UPGRADE_MONITOR_KEY: key, TESTNET_UPGRADE_GUARDS: JSON.stringify(Object.values(guards)) })) {
      env = env.replace(new RegExp(`^${name}=.*\\n?`, "m"), "");
      env += `${name}=${value}\n`;
    }
    fs.writeFileSync(file, env, { mode: 0o600 });
    if (await network.client.getBalance({ address: monitor.address }) < viem.parseEther("0.2")) {
      await network.send("fund-upgrade-monitor", "0x", monitor.address, viem.parseEther("0.3"));
    }
  }
  const book = await read(market, marketAbi, "getL2Book", [16, 16]);
  const words = book.slice(2).match(/.{64}/g)?.map((w) => BigInt(`0x${w}`));
  if (!words || book.length !== 2 + words.length * 64 || words.length < 6) throw new Error("Kuru market has no two-sided liquidity");
  let cursor = 1;
  for (const direction of ["bid", "ask"]) {
    let count = 0;
    while (cursor < words.length && words[cursor] !== 0n) {
      if (!words[cursor + 1] || words[cursor] >= 2n ** 32n) throw new Error("Invalid Kuru liquidity level");
      cursor += 2; count++;
    }
    if (count === 0 || direction === "bid" && words[cursor] !== 0n
      || direction === "ask" && cursor !== words.length) throw new Error(`Kuru market has no ${direction} liquidity`);
    if (direction === "bid") cursor++;
  }
  if (cursor !== words.length) throw new Error("Invalid Kuru liquidity framing");
  report.completedAt = new Date().toISOString(); persist();
  if (!simulate) writeConfiguration("kuru-market", { core: m.TermbookCore, factory, market, vault, margin, forwarder,
    settlementAsset: usdc, monitor: monitor.address, trustModel: "testnet RPC monitor; 180-second expiring approval",
    bid: report.bid ?? prior.bid, ask: report.ask ?? prior.ask, makerBaseMON: "1", makerQuoteUSDC: "1", guards, dependencies,
    oracleGuard, completedAt: report.completedAt, transactions: report.transactions });
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, market, guards: Object.keys(guards).length, transactions: report.transactions.length,
    gasMON: viem.formatEther(cost), liquidityMON: "1", liquidityUSDC: "1", admission: "pending validation" }));
  clearOperation("kuru-setup", simulate);
}

main().catch((cause) => {
  if (cause && typeof cause === "object" && Array.isArray(cause.failures)) error(JSON.stringify({ error: cause.message, sources: cause.failures }));
  else error(cause instanceof Error ? cause.message.split("\n")[0] : "Kuru setup failed");
  process.exitCode = 1;
});
