import { alreadyConfigured, writeConfiguration, clearOperation } from "./testnet-state.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { root, viem, artifact, testnetRuntime, writeJsonAtomic } from "./testnet-runtime.mjs";
import { validateUpgradeArtifact } from "./upgrade-validation.mjs";

const simulate = process.argv[2] === "--simulate";
const sourceChain = Number(process.argv[3] ?? 11155111);
const safe = sourceChain === 84532;
const stage = safe ? `confirmations-${sourceChain}` : "confirmations";
const journal = `${stage}-setup`;
if (![3, 4].includes(process.argv.length) || ![11155111, 84532].includes(sourceChain)
  || !["--simulate", "--broadcast"].includes(process.argv[2])) throw new Error("Use <--simulate|--broadcast> [11155111|84532]");
async function main() {
  if (!simulate && alreadyConfigured(stage)) { clearOperation(journal); log(JSON.stringify({ configured: true, step: stage })); return; }
  const runtime = await testnetRuntime(journal, simulate);
  const { deployment, report, persist } = runtime;
  const monad = await runtime.context(10143), source = await runtime.context(sourceChain);
  const m = deployment.addresses[10143], s = deployment.addresses[sourceChain];
  const houses = new Set([m.HouseVault, deployment.configuration["kuru-house"]?.proxy?.address].filter(Boolean));
  if (!report.completedAt) for (const house of houses) if (await monad.read("HouseVault", house, "activeCreditCount") !== 0n) throw new Error("Settle existing credits before changing the source confirmation policy");
  const baseline = deployment.proxies[sourceChain].WormholeEthereumPublisher;
  const candidate = artifact("WormholeEthereumPublisher");
  validateUpgradeArtifact(baseline, candidate);
  const implementation = await source.deploy("WormholeEthereumPublisher", [viem.zeroAddress, viem.zeroAddress, viem.zeroAddress], "PublisherConfirmationImplementation");
  await source.govern("UpgradeController", s.UpgradeController, "upgrade", [s.WormholeEthereumPublisher, implementation, viem.keccak256(candidate.deployedBytecode.object), "0x"]);
  await source.govern("WormholeEthereumPublisher", s.WormholeEthereumPublisher,
    safe ? "configureTestnetSafe" : "configureTestnetConfirmations", safe ? [] : [5]);
  async function proxy(name, args, label, initializer = "initialize", constructorArgs) {
    const compiled = artifact(name);
    const empty = constructorArgs ?? (compiled.abi.find((entry) => entry.type === "constructor")?.inputs ?? []).map((input) =>
      input.type === "address" ? viem.zeroAddress : input.type.startsWith("bytes") ? `0x${"00".repeat(Number(input.type.slice(5)))}` : 0n);
    const impl = await monad.deploy(name, empty, `${label}Implementation`);
    const initialization = viem.encodeFunctionData({ abi: compiled.abi, functionName: initializer, args });
    const address = await monad.deploy("TestnetProxy", [impl, m.UpgradeController, initialization], label);
    await monad.govern("UpgradeController", m.UpgradeController, "register", [address]);
    report.proxies ??= {};
    report.proxies[label] = { implementation: impl, implementationCodeHash: viem.keccak256(compiled.deployedBytecode.object),
      contractId: await monad.read(name, address, "upgradeContractId"), storageLayout: compiled.storageLayout, abi: compiled.abi };
    persist(); return address;
  }
  const wormhole = await monad.read("TermbookCore", m.TermbookCore, "ethereumWormholeCore");
  const clientLabel = safe ? `Evm${sourceChain}SafeClient` : "SepoliaConfirmationClient";
  const verifierLabel = safe ? `Evm${sourceChain}SafeVerifier` : "SepoliaConfirmationVerifier";
  const clientName = safe ? "WormholeEvmPolicyClient" : "WormholeSepoliaMessageClient";
  const client = await proxy(clientName, safe ? [wormhole, BigInt(sourceChain), s.WormholeEthereumPublisher, 7200n]
    : [wormhole, s.WormholeEthereumPublisher, 5, 2n, 7200n], clientLabel, safe ? "initializeSafe" : "initializeCustom", []);
  const hash = async (address) => viem.keccak256(await source.client.getCode({ address }));
  const verifier = await proxy("WormholeEthereumVerifier", [client, s.WormholeEthereumPublisher, await hash(s.WormholeEthereumPublisher),
    s.CollateralVault, await hash(s.CollateralVault), s.RemoteCollateralController, await hash(s.RemoteCollateralController)], verifierLabel);
  await monad.govern("VerifierRegistry", m.VerifierRegistry, "setVerifier", [BigInt(sourceChain), verifier, safe ? 3n : 2n, 7200n]);
  const publisherPolicy = await source.read("WormholeEthereumPublisher", s.WormholeEthereumPublisher, "confirmationPolicyHash");
  if (publisherPolicy !== await monad.read(clientName, client, "confirmationPolicyHash")) throw new Error("Confirmation policy mismatch");
  report.completedAt = new Date().toISOString(); persist();
  const cost = report.transactions.filter((tx) => tx.chainId === 10143).reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  if (!simulate) {
    const envFile = path.join(root, ".env");
    let env = fs.readFileSync(envFile, "utf8");
    const markets = JSON.parse(env.match(/^COLLATERAL_MARKETS=(.*)$/m)?.[1] ?? "[]").map((market) =>
      market.kind === "evm" && market.chainId === sourceChain ? { ...market, ...(safe ? { testnetFinality: "safe", rpcUrl: "https://base-sepolia-rpc.publicnode.com" } : { testnetConfirmations: 5 }) } : market);
    env = env.replace(/^COLLATERAL_MARKETS=.*\n?/m, "") + `COLLATERAL_MARKETS=${JSON.stringify(markets)}\n`;
    if (safe) {
      const urls = JSON.parse(env.match(/^EVM_SOURCE_RPC_URLS=(.*)$/m)?.[1] ?? "{}");
      urls[String(sourceChain)] = "https://base-sepolia-rpc.publicnode.com";
      env = env.replace(/^EVM_SOURCE_RPC_URLS=.*\n?/m, "") + `EVM_SOURCE_RPC_URLS=${JSON.stringify(urls)}\n`;
    }
    fs.writeFileSync(envFile, env, { mode: 0o600 });
    deployment.proxies[sourceChain].WormholeEthereumPublisher = { ...baseline, implementation,
      implementationCodeHash: viem.keccak256(candidate.deployedBytecode.object), storageLayout: candidate.storageLayout, abi: candidate.abi };
    for (const label of Object.keys(report.proxies)) { deployment.addresses[10143][label] = report.addresses[label]; deployment.proxies[10143][label] = report.proxies[label]; }
    if (safe) {
      deployment.addresses[10143][`Evm${sourceChain}MessageClient`] = client;
      deployment.addresses[10143][`Evm${sourceChain}Verifier`] = verifier;
      deployment.proxies[10143][`Evm${sourceChain}MessageClient`] = report.proxies[clientLabel];
      deployment.proxies[10143][`Evm${sourceChain}Verifier`] = report.proxies[verifierLabel];
      deployment.configuration[`evm-source-${sourceChain}`].verifier = verifier;
    }
    writeJsonAtomic(path.join(root, "deployments/testnet.json"), deployment);
    writeConfiguration(stage, { network: "testnet", completedAt: report.completedAt,
      sourceChain, destinationChain: 10143, confirmationDepth: safe ? 0 : 5, consistency: safe ? 201 : 203,
      finality: safe ? "safe" : "confirmations", verifierVersion: safe ? 3 : 2, policyHash: publisherPolicy,
      publisher: s.WormholeEthereumPublisher, client, verifier,
      transactions: report.transactions.map(({ rawTransaction: _raw, ...tx }) => tx) });
  }
  log(JSON.stringify({ simulated: simulate, transactions: report.transactions.length, costMON: viem.formatEther(cost), policyHash: publisherPolicy }));
  if (!simulate) clearOperation(journal, false);
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Confirmation setup failed"); process.exitCode = 1; });
