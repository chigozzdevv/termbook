import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { root, viem, artifact } from "./testnet-runtime.mjs";
import { readConfiguration, writeJsonAtomic, operationFile, clearOperation } from "./testnet-state.mjs";
import { setTimeout as delay } from "node:timers/promises";

const priceSource = process.argv[2] === "--publish-price-source";
const healthSource = process.argv[2] === "--publish-health-source";
const oracleSources = process.argv[2] === "--publish-oracle-sources";
const publish = process.argv[2] === "--publish-sources" || priceSource || healthSource || oracleSources;
if (process.argv.length !== (publish ? 3 : 2)) throw new Error("Use no arguments, --publish-sources, --publish-price-source, --publish-health-source or --publish-oracle-sources");

const canonical = (value) => JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry);
function equal(actual, expected, label) {
  if (canonical(actual).toLowerCase() !== canonical(expected).toLowerCase()) throw new Error(`Verification failed: ${label}`);
}

async function main() {
  const deployment = JSON.parse(fs.readFileSync(path.join(root, "deployments/testnet.json"), "utf8"));
  const orderUpdate = deployment.sharedIntegrations?.configuration === "order-integrations";
  const report = readConfiguration(orderUpdate ? "order-integrations" : "integrations", deployment);
  const client = viem.createPublicClient({ transport: viem.http("https://testnet-rpc.monad.xyz") });
  equal(await client.getChainId(), 10143, "network");
  const block = await client.getBlock({ blockTag: "finalized" });
  const m = deployment.addresses[10143];
  equal(report.core, m.TermbookCore, "Core address");
  const read = (name, address, functionName, args = []) => client.readContract({ address, abi: artifact(name).abi, functionName, args, blockNumber: block.number });
  equal(await read("ProtocolGovernance", m.ProtocolGovernance, "governance"), deployment.deployer, "governance owner");
  equal(await read("ProtocolGovernance", m.ProtocolGovernance, "timelock"), 0n, "testnet delay");
  equal(await read("UpgradeController", m.UpgradeController, "owner"), m.ProtocolGovernance, "upgrade owner");
  for (const [name, address, method, expected] of [
    ["TermbookCore", m.TermbookCore, "healthSource", m.AccountHealthSource],
    ["AccountHealthSource", m.AccountHealthSource, "core", m.TermbookCore],
    ["AccountHealthSource", m.AccountHealthSource, "source", m.HealthSource],
    ["AccountHealthSource", m.AccountHealthSource, "accountFactory", m.AccountFactory],
    ["AccountHealthSource", m.AccountHealthSource, "oracleRegistry", m.OracleRegistry],
  ]) equal(await read(name, address, method), expected, `${name}.${method}`);
  for (const [name, pin] of Object.entries(deployment.proxies[10143])) {
    const proxy = m[name];
    equal(await read("TestnetProxy", proxy, "proxyImplementation"), pin.implementation, `${name} implementation`);
    const admin = await read("TestnetProxy", proxy, "proxyAdmin");
    if (pin.admin) equal(admin, pin.admin, `${name} administrator`);
    equal(await client.readContract({ address: admin, abi: viem.parseAbi(["function owner() view returns (address)"]), functionName: "owner", blockNumber: block.number }), m.UpgradeController, `${name} administrator owner`);
    equal(await read("UpgradeController", m.UpgradeController, "contractIds", [proxy]), pin.contractId, `${name} identity`);
    equal(viem.keccak256(await client.getCode({ address: pin.implementation, blockNumber: block.number })), pin.implementationCodeHash, `${name} code`);
  }
  const compiledUpgrades = oracleSources ? ["OracleRegistry"] : healthSource ? ["HealthSource"] : priceSource ? ["PriceProtection"] : orderUpdate ? ["FlowExecutor"] : report.priceUpdate ? ["PriceProtection"] : ["FlowExecutor", "AccountFactory", "PriceProtection", "TermbookCore"];
  for (const name of compiledUpgrades) {
    equal(deployment.proxies[10143][name].implementationCodeHash, viem.keccak256(artifact(name).deployedBytecode.object), `${name} compiled code`);
  }
  const a = report.addresses;
  for (const [name, address] of Object.entries(a)) {
    equal(address, m[name], `${name} manifest`);
    const compiled = artifact(name).deployedBytecode;
    const code = await client.getCode({ address, blockNumber: block.number });
    const normalize = (value) => {
      let result = value.slice(2);
      for (const refs of Object.values(compiled.immutableReferences ?? {})) for (const { start, length } of refs) {
        result = result.slice(0, start * 2) + "0".repeat(length * 2) + result.slice((start + length) * 2);
      }
      return `0x${result}`;
    };
    if (report.contractPins[name]?.codeHash) equal(viem.keccak256(code), report.contractPins[name].codeHash, `${name} installed code`);
    else equal(normalize(code), normalize(compiled.object), `${name} compiled runtime`);
    const bindings = name === "ReadProgram" ? { governance: m.ProtocolGovernance }
      : name === "AppHealthReaderFactory" ? { core: m.TermbookCore, collateralReader: m.CollateralHealthReader }
        : { governance: m.ProtocolGovernance, core: m.TermbookCore,
          ...(["UseCaseReader", "SpotOrderTracker", "AtomicSpotRouter", "AtomicSpotModule"].includes(name) ? { registry: m.IntegrationRegistry } : {}),
          ...(["UseCaseReader", "SpotOrderTracker"].includes(name) ? { programs: a.ReadProgram ?? m.ReadProgram } : {}),
          ...(["UseCasePolicy", "UseCaseRecovery"].includes(name) ? { reader: a.UseCaseReader } : {}),
          ...(name === "AtomicSpotModule" ? { router: a.AtomicSpotRouter } : {}) };
    for (const [method, expected] of Object.entries(bindings)) equal(await read(name, address, method), expected, `${name}.${method}`);
  }
  if (publish) {
    const freshAddresses = deployment.configuration["fresh-prices"]?.addresses;
    if (oracleSources && !freshAddresses) throw new Error("Fresh pricing migration required before publishing");
    const extra = oracleSources ? [
      { name: "OracleRegistryImplementation", artifact: "OracleRegistry", address: deployment.proxies[10143].OracleRegistry.implementation },
      ...Object.entries(freshAddresses).map(([name, address]) => ({ name, address, artifact: name.endsWith("PriceFeed") && !name.includes("Ratio") ? "PythPriceFeed"
        : name === "ETHLiveRatioPriceFeed" ? "LiveRatioPriceFeed" : name === "ETHRatioGuard" ? "CodeHashGuard" : "ImplementationGuard" })),
    ] : healthSource ? [
      { name: "HealthSourceImplementation", artifact: "HealthSource", address: deployment.proxies[10143].HealthSource.implementation },
    ] : priceSource ? [
      { name: "PriceProtectionImplementation", artifact: "PriceProtection", address: deployment.proxies[10143].PriceProtection.implementation },
    ] : orderUpdate ? [
      ...Object.entries(a).map(([name, address]) => ({ name, artifact: name, address })),
      { name: "FlowExecutorImplementation", artifact: "FlowExecutor", address: deployment.proxies[10143].FlowExecutor.implementation },
    ] : [
      { name: "PriceProtectionImplementation", artifact: "PriceProtection", address: deployment.proxies[10143].PriceProtection.implementation },
      { name: "OracleRegistryImplementation", artifact: "OracleRegistry", address: deployment.proxies[10143].OracleRegistry.implementation },
      { name: "OracleRegistryProxy", artifact: "TestnetProxy", address: m.OracleRegistry },
      ...(deployment.configuration["kuru-market"]?.oracleGuard ? [{ name: "KuruOracleGuard", artifact: "ImplementationGuard",
        address: deployment.configuration["kuru-market"].oracleGuard.address }] : []),
      ...Object.entries(deployment.configuration["kuru-market"]?.guards ?? {}).map(([proxy, guard]) => ({
        name: `KuruMonitor-${proxy}`, artifact: "TestnetUpgradeGuard", address: guard.address,
      })),
    ];
    const file = operationFile("integration-source-verification");
    const jobs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    const api = "https://sourcify.dev/server/v2";
    report.sourceVerification ??= { contracts: [] };
    for (const target of extra) {
      const build = artifact(target.artifact), code = await client.getCode({ address: target.address, blockNumber: block.number });
      const normalize = (value) => {
        let result = value.slice(2);
        for (const refs of Object.values(build.deployedBytecode.immutableReferences ?? {})) for (const { start, length } of refs) {
          result = result.slice(0, start * 2) + "0".repeat(length * 2) + result.slice((start + length) * 2);
        }
        return result;
      };
      equal(normalize(code), normalize(build.deployedBytecode.object), `${target.name} compiled code`);
      const url = `${api}/contract/10143/${target.address}`;
      const currentResponse = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(20_000) });
      let verified = currentResponse.ok ? await currentResponse.json() : null;
      if (verified?.runtimeMatch !== "exact_match") {
        const sources = {};
        for (const [name, pin] of Object.entries(build.metadata.sources)) {
          const sourceFile = path.resolve(root, "contracts/evm", name);
          if (!name.endsWith(".sol") || !sourceFile.startsWith(`${root}${path.sep}`)) throw new Error("Invalid compiler source path");
          const content = fs.readFileSync(sourceFile, "utf8");
          equal(viem.keccak256(viem.toHex(content)), pin.keccak256, `${target.name} source ${name}`);
          sources[name] = { content };
        }
        const settings = { ...build.metadata.settings }; delete settings.compilationTarget;
        settings.outputSelection = { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] } };
        const compiledTarget = Object.entries(build.metadata.settings.compilationTarget)[0];
        const body = { stdJsonInput: { language: "Solidity", sources, settings }, compilerVersion: build.metadata.compiler.version,
          contractIdentifier: compiledTarget.join(":") };
        const inputHash = viem.keccak256(viem.toHex(JSON.stringify(body)));
        let job = jobs[target.address.toLowerCase()];
        if (job && job.inputHash !== inputHash) throw new Error("Source verification input changed");
        if (!job) {
          const response = await globalThis.fetch(`${api}/verify/10143/${target.address}`, { method: "POST",
            headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: globalThis.AbortSignal.timeout(30_000) });
          const result = await response.json();
          if (!response.ok || !/^[a-f0-9-]{36}$/i.test(result.verificationId ?? "")) throw new Error(`Source publication rejected: ${target.name}`);
          job = jobs[target.address.toLowerCase()] = { inputHash, verificationId: result.verificationId };
          writeJsonAtomic(file, jobs);
        }
        const deadline = Date.now() + 120_000;
        for (;;) {
          const response = await globalThis.fetch(`${api}/verify/${job.verificationId}`, { signal: globalThis.AbortSignal.timeout(20_000) });
          const status = await response.json();
          if (!response.ok || status.error) throw new Error(`Source verification failed: ${target.name}`);
          if (status.isJobCompleted) break;
          if (Date.now() >= deadline) throw new Error(`Source verification pending: ${target.name}`);
          await delay(2000);
        }
        const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`Source verification unavailable: ${target.name}`);
        verified = await response.json();
      }
      if (verified.runtimeMatch !== "exact_match") throw new Error(`Source did not match: ${target.name}`);
      const index = report.sourceVerification.contracts.findIndex((item) => item.name === target.name);
      const previous = report.sourceVerification.contracts[index];
      const record = { ...(previous?.address.toLowerCase() === target.address.toLowerCase() ? previous : {}),
        name: target.name, address: target.address,
        ...(jobs[target.address.toLowerCase()] ? { verificationId: jobs[target.address.toLowerCase()].verificationId } : {}),
        matchId: verified.matchId, verifiedAt: verified.verifiedAt, runtimeMatch: verified.runtimeMatch,
        creationMatch: verified.creationMatch, url };
      if (index < 0) report.sourceVerification.contracts.push(record);
      else report.sourceVerification.contracts[index] = record;
      writeJsonAtomic(path.join(root, "deployments/testnet.json"), deployment);
      log(JSON.stringify({ sourceVerified: target.name, address: target.address, runtimeMatch: verified.runtimeMatch }));
    }
    clearOperation("integration-source-verification");
  }
  equal((await client.getBlock({ blockNumber: block.number })).hash, block.hash, "canonical verification block");
  log(JSON.stringify({ verified: true, block: block.number.toString(), blockHash: block.hash,
    proxies: Object.keys(deployment.proxies[10143]).length, components: Object.keys(a).length }));
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Upgrade verification failed"); process.exitCode = 1; });
