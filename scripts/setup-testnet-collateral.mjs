import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log } from "node:console";
import { root, viem, testnetRuntime, writeJsonAtomic } from "./testnet-runtime.mjs";
import { manifestFile, alreadyConfigured, writeConfiguration, clearOperation } from "./testnet-state.mjs";
import { upgradeArtifactLoader } from "./upgrade-validation.mjs";

const chainId = Number(process.argv[2]);
const simulate = process.argv[3] === "--simulate";
const sourceOnly = process.argv[3] === "--deploy-source";
if (process.argv.length !== 4 || ![11155111, 84532].includes(chainId) || !["--simulate", "--deploy-source", "--broadcast"].includes(process.argv[3])) {
  throw new Error("Use setup-testnet-collateral.mjs <11155111|84532> <--simulate|--deploy-source|--broadcast>");
}
const stage = `evm-source-${chainId}`;
const sourceWormholeId = chainId === 84532 ? 10004 : 10002;
const sourceWormhole = chainId === 84532 ? "0x79A1027a6A159502049F10906D333EC57E95F083" : "0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78";
const asset = chainId === 84532 ? "0x4200000000000000000000000000000000000006" : "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const sourceRpc = chainId === 84532 ? "https://sepolia.base.org" : "https://ethereum-sepolia-rpc.publicnode.com";
const label = (name) => `Source${chainId}${name}`;
const compiled = upgradeArtifactLoader(path.join(root, "contracts/evm/out"));

async function main() {
  if (!simulate && alreadyConfigured(stage)) { log(JSON.stringify({ configured: true, stage })); return; }
  const runtime = await testnetRuntime(stage, simulate);
  const { deployment, report, persist } = runtime;
  const source = await runtime.context(chainId), monad = await runtime.context(10143);
  const m = deployment.addresses[10143];
  const core = m.TermbookCore, factory = m.InboxFactory;
  const existing = await monad.read("VerifierRegistry", m.VerifierRegistry, "verifiers", [BigInt(chainId)]);
  if (existing[2] && existing[0].toLowerCase() !== report.addresses[`Base${chainId}Evm${chainId}Verifier`]?.toLowerCase()) {
    throw new Error("Source chain is already admitted; upgrade its existing deployment");
  }
  if (await source.read("IWormholeCore", sourceWormhole, "chainId") !== sourceWormholeId) throw new Error("Source Wormhole identity mismatch");
  if (!await source.client.getCode({ address: asset })) throw new Error("Source WETH is unavailable");
  if (!viem.isAddress(core) || !viem.isAddress(factory)) throw new Error("Monad deployment is unavailable");
  const governance = await source.deploy("ProtocolGovernance", [deployment.deployer, 0n], label("ProtocolGovernance"));
  const upgrades = await source.deploy("UpgradeController", [deployment.deployer], label("UpgradeController"));
  report.proxies ??= {};
  const proxies = report.proxies[chainId] ??= {};
  const keepers = deployment.configuration.keepers?.keepers;
  if (!viem.isAddress(deployment.recoveryRiskSigner) || !keepers?.risk || !keepers?.ethereumPublisher || !keepers?.sourceAction) throw new Error("Configure keeper roles first");
  async function deployProxy(context, id, name, args, key = name, controller = upgrades) {
    const prefix = id === 10143 ? `Base${chainId}${key}` : label(key);
    const build = compiled(name);
    const zero = (input) => input.type === "address" ? viem.zeroAddress : input.type.startsWith("bytes") ? viem.zeroHash : 0n;
    const implementation = await context.deploy(name, (build.abi.find((item) => item.type === "constructor")?.inputs ?? []).map(zero), `${prefix}Implementation`);
    const data = viem.encodeFunctionData({ abi: build.abi, functionName: "initialize", args });
    const proxy = await context.deploy("TestnetProxy", [implementation, controller, data], prefix);
    if (id === chainId) await context.call("UpgradeController", controller, "register", [proxy], `register:${prefix}`);
    else await context.govern("UpgradeController", controller, "register", [proxy]);
    report.proxies[id] ??= {};
    report.proxies[id][key] = { implementation, admin: await context.read("TestnetProxy", proxy, "proxyAdmin"),
      contractId: await context.read(name, implementation, "upgradeContractId"),
      implementationCodeHash: viem.keccak256(await context.client.getCode({ address: implementation })), storageLayout: build.storageLayout, abi: build.abi };
    persist(); return proxy;
  }
  const monadWormhole = await monad.read("TermbookCore", core, "ethereumWormholeCore");
  if (await monad.read("IWormholeCore", monadWormhole, "chainId") !== 10009) throw new Error("Monad Wormhole identity mismatch");
  const auth = await deployProxy(source, chainId, "WormholeEvmMessageClient", [sourceWormhole, sourceWormholeId, 10009, 10143n, 1n, viem.padHex(core, { size: 32 }), 7200n], "AuthorizationClient");
  const rec = await deployProxy(source, chainId, "WormholeEvmMessageClient", [sourceWormhole, sourceWormholeId, 10009, 10143n, 1n, viem.padHex(factory, { size: 32 }), 7200n], "RecoveryClient");
  const reverse = await deployProxy(source, chainId, "WormholeMonadVerifier", [auth, rec, core, factory]);
  const recovery = await deployProxy(source, chainId, "SourceRecoveryVault", [asset, 10143n, factory, reverse, governance, deployment.deployer, deployment.recoveryRiskSigner]);
  const controller = await deployProxy(source, chainId, "RemoteCollateralController", [asset, 10143n, core, recovery, reverse, governance, governance]);
  const vault = await source.read("RemoteCollateralController", controller, "vault");
  const publisher = await deployProxy(source, chainId, "WormholeEthereumPublisher", [vault, controller, sourceWormhole]);
  const sourceHash = async (address) => viem.keccak256(await source.client.getCode({ address }));
  await source.govern("SourceRecoveryVault", recovery, "setController", [controller]);
  await source.govern("SourceRecoveryVault", recovery, "setPaused", [false]);
  await source.govern("RemoteCollateralController", controller, "setPaused", [false]);
  if ((await source.read("UpgradeController", upgrades, "owner")).toLowerCase() === deployment.deployer.toLowerCase()) {
    await source.call("UpgradeController", upgrades, "transferOwnership", [governance]);
    await source.govern("UpgradeController", upgrades, "acceptOwnership", []);
  }
  for (const name of ["ethereumPublisher", "sourceAction"]) {
    const target = viem.parseEther("0.0001");
    report.topups ??= {};
    if (report.topups[name] === undefined) {
      const balance = await source.client.getBalance({ address: keepers[name] });
      report.topups[name] = String(balance < target ? target - balance : 0n); persist();
    }
    if (BigInt(report.topups[name]) > 0n) await source.send(`fund:${name}`, "0x", keepers[name], BigInt(report.topups[name]));
  }
  const recordSource = () => {
    deployment.addresses[chainId] = { ProtocolGovernance: governance, UpgradeController: upgrades,
      AuthorizationClient: auth, RecoveryClient: rec, WormholeMonadVerifier: reverse, SourceRecoveryVault: recovery,
      RemoteCollateralController: controller, CollateralVault: vault, WormholeEthereumPublisher: publisher };
    deployment.tokens[chainId] = { WETH: asset };
    deployment.proxies[chainId] = proxies;
    deployment.deploymentBlocks[chainId] = report.transactions.find((tx) => tx.chainId === chainId).block;
  };
  if (sourceOnly) {
    recordSource(); writeJsonAtomic(manifestFile, deployment);
    log(JSON.stringify({ stage, sourceDeployed: true, vault, publisher, admissionPending: true })); return;
  }
  if (!simulate) for (const name of ["TermbookCore", "InboxFactory"]) {
    const implementation = await monad.read("TestnetProxy", m[name], "proxyImplementation");
    if (viem.keccak256(await monad.client.getCode({ address: implementation })) !== viem.keccak256(compiled(name).deployedBytecode.object)) {
      throw new Error(`Upgrade ${name} before admitting the source chain`);
    }
  }
  const client = await deployProxy(monad, 10143, "WormholeEvmMessageClient", [monadWormhole, 10009, sourceWormholeId, BigInt(chainId), 1n, viem.padHex(publisher, { size: 32 }), 7200n], `Evm${chainId}MessageClient`, m.UpgradeController);
  const verifier = await deployProxy(monad, 10143, "WormholeEthereumVerifier", [client, publisher, await sourceHash(publisher), vault, await sourceHash(vault), controller, await sourceHash(controller)], `Evm${chainId}Verifier`, m.UpgradeController);
  const ratio = deployment.configuration.setup.addresses.RatioPriceFeed;
  const feeds = deployment.configuration.setup.feeds;
  const prices = await Promise.all([feeds.ETH.id, feeds.USDC.id].map((id) => monad.read("OracleRegistry", m.OracleRegistry, "read", [id])));
  if (!deployment.configuration.setup.addresses.ETHLiveRatioPriceFeed) {
    const rounds = await Promise.all(["baseRound", "quoteRound"].map((field) => monad.read("RatioPriceFeed", ratio, field)));
    if (rounds[0] !== prices[0][2] || rounds[1] !== prices[1][2]) await monad.call("RatioPriceFeed", ratio, "update", [], `ratio:${prices[0][2]}:${prices[1][2]}`);
  }
  const priceId = deployment.configuration.setup.priceId;
  const usdc = deployment.tokens[10143].USDC;
  await monad.govern("VerifierRegistry", m.VerifierRegistry, "setVerifier", [BigInt(chainId), verifier, 1n, 7200n]);
  await monad.govern("TermbookCore", core, "setSourceCollateralVault", [BigInt(chainId), asset, vault]);
  await monad.govern("TermbookCore", core, "setSourceRecoveryVault", [BigInt(chainId), asset, recovery]);
  await monad.govern("TermbookCore", core, "setRemoteSalePolicy", [BigInt(chainId), asset, usdc, m.OracleRegistry, priceId, 18, 9500, viem.parseEther("0.01")]);
  await monad.govern("CollateralHealthReader", m.CollateralHealthReader, "setMarket", [BigInt(chainId), asset, usdc, priceId, 18, 8000, 50_000n]);
  report.sourceChain = chainId; report.asset = asset; report.rpcUrl = sourceRpc;
  report.vault = vault; report.controller = controller; report.recovery = recovery; report.publisher = publisher;
  report.verifier = verifier; report.priceId = priceId; report.retainedSourceBps = 8000; report.recoveryCosts = "50000";
  report.completedAt = new Date().toISOString(); persist();
  const cost = report.transactions.reduce((total, tx) => {
    const chain = String(tx.chainId); total[chain] = (BigInt(total[chain] ?? 0) + BigInt(tx.gasLimit) * BigInt(tx.gasPrice)).toString(); return total;
  }, {});
  if (!simulate) {
    recordSource();
    deployment.addresses[10143][`Evm${chainId}MessageClient`] = client;
    deployment.addresses[10143][`Evm${chainId}Verifier`] = verifier;
    Object.assign(deployment.proxies[10143], report.proxies[10143]);
    writeJsonAtomic(manifestFile, deployment);
    const configuration = { ...report }; delete configuration.proxies;
    writeConfiguration(stage, configuration);
    const envFile = path.join(root, ".env");
    let text = fs.readFileSync(envFile, "utf8");
    const rpcUrls = JSON.parse(text.match(/^EVM_SOURCE_RPC_URLS=(.*)$/m)?.[1] ?? "{}");
    rpcUrls[String(chainId)] = sourceRpc;
    const markets = JSON.parse(text.match(/^COLLATERAL_MARKETS=(.*)$/m)?.[1] ?? "[]").filter((market) => market.id !== stage);
    markets.push({ id: stage, label: chainId === 84532 ? "ETH (Base Sepolia)" : "ETH (Sepolia)", kind: "evm", chainId, asset,
      vault, controller, decimals: 18, rpcUrl: sourceRpc, wrapNative: true });
    for (const [key, value] of Object.entries({ EVM_SOURCE_RPC_URLS: JSON.stringify(rpcUrls), COLLATERAL_MARKETS: JSON.stringify(markets) })) {
      text = text.replace(new RegExp(`^${key}=.*\\n?`, "m"), ""); text += `${key}=${value}\n`;
    }
    fs.writeFileSync(envFile, text, { mode: 0o600 }); clearOperation(stage);
  }
  log(JSON.stringify({ simulated: simulate, stage, costWei: cost, vault, verifier }));
}
await main();
