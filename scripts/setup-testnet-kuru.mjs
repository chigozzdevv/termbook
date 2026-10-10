import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { createRequire } from "node:module";
import { root, viem, testnetRuntime } from "./testnet-runtime.mjs";
import { writeConfiguration, clearOperation } from "./testnet-state.mjs";

const simulate = process.argv.includes("--simulate");
if (simulate === process.argv.includes("--broadcast") || process.argv.length !== 3
  || process.argv.slice(2).some((a) => !["--simulate", "--broadcast"].includes(a))) throw new Error("Use --simulate or --broadcast");
const factory = "0x7EFbE105Ca7415dE98F96622173458ac1c054630";
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
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
]);
const tokenAbi = viem.parseAbi(["function approve(address,uint256) returns(bool)"]);
const marginAbi = viem.parseAbi(["function deposit(address,address,uint256) payable"]);
const require = createRequire(path.join(root, "packages/sdk/package.json"));
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

async function main() {
  const runtime = await testnetRuntime("kuru-setup", simulate);
  const { deployment, report, persist } = runtime;
  const network = await runtime.context(10143);
  const m = deployment.addresses[10143];
  const setup = deployment.configuration.native;
  if (!setup || setup.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Admit native MON prices first");
  const usdc = deployment.tokens[10143].USDC;
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
  for (const address of [...new Set([market, factory, vault, margin, forwarder].map((a) => a.toLowerCase()))]) {
    const codeHash = viem.keccak256(await network.client.getCode({ address }));
    const slot = await network.client.getStorageAt({ address, slot: implementationSlot });
    if (!slot || !/^0x0{24}[a-fA-F0-9]{40}$/.test(slot)) throw new Error("Unsupported Kuru dependency storage");
    const implementation = viem.getAddress(`0x${slot.slice(-40)}`);
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
      implementationCodeHash: viem.keccak256(await network.client.getCode({ address: implementation })), guard: guards[address].address } : {}) });
  }
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
    completedAt: report.completedAt, transactions: report.transactions });
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, market, guards: Object.keys(guards).length, transactions: report.transactions.length,
    gasMON: viem.formatEther(cost), liquidityMON: "1", liquidityUSDC: "1", admission: "pending validation" }));
  clearOperation("kuru-setup", simulate);
}

main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Kuru setup failed"); process.exitCode = 1; });
