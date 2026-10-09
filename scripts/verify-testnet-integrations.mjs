import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { root, viem, artifact } from "./testnet-runtime.mjs";
import { readConfiguration } from "./testnet-state.mjs";

const canonical = (value) => JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry);
function equal(actual, expected, label) {
  if (canonical(actual).toLowerCase() !== canonical(expected).toLowerCase()) throw new Error(`Verification failed: ${label}`);
}

async function main() {
  const deployment = JSON.parse(fs.readFileSync(path.join(root, "deployments/testnet.json"), "utf8"));
  const report = readConfiguration("integrations", deployment);
  const client = viem.createPublicClient({ transport: viem.http("https://testnet-rpc.monad.xyz") });
  equal(await client.getChainId(), 10143, "network");
  const block = await client.getBlock({ blockTag: "finalized" });
  const m = deployment.addresses[10143];
  equal(report.core, m.TermbookCore, "Core address");
  const read = (name, address, functionName, args = []) => client.readContract({ address, abi: artifact(name).abi, functionName, args, blockNumber: block.number });
  equal(await read("ProtocolGovernance", m.ProtocolGovernance, "governance"), deployment.deployer, "governance owner");
  equal(await read("ProtocolGovernance", m.ProtocolGovernance, "timelock"), 0n, "testnet delay");
  equal(await read("UpgradeController", m.UpgradeController, "owner"), m.ProtocolGovernance, "upgrade owner");
  for (const [name, pin] of Object.entries(deployment.proxies[10143])) {
    const proxy = m[name];
    equal(await read("TestnetProxy", proxy, "proxyImplementation"), pin.implementation, `${name} implementation`);
    const admin = await read("TestnetProxy", proxy, "proxyAdmin");
    if (pin.admin) equal(admin, pin.admin, `${name} administrator`);
    equal(await client.readContract({ address: admin, abi: viem.parseAbi(["function owner() view returns (address)"]), functionName: "owner", blockNumber: block.number }), m.UpgradeController, `${name} administrator owner`);
    equal(await read("UpgradeController", m.UpgradeController, "contractIds", [proxy]), pin.contractId, `${name} identity`);
    equal(viem.keccak256(await client.getCode({ address: pin.implementation, blockNumber: block.number })), pin.implementationCodeHash, `${name} code`);
  }
  for (const name of ["FlowExecutor", "AccountFactory", "PriceProtection", "TermbookCore"]) {
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
    equal(normalize(code), normalize(compiled.object), `${name} compiled runtime`);
    const bindings = name === "ReadProgram" ? { governance: m.ProtocolGovernance }
      : name === "AppHealthReaderFactory" ? { core: m.TermbookCore, collateralReader: m.CollateralHealthReader }
        : { governance: m.ProtocolGovernance, core: m.TermbookCore,
          ...(["UseCaseReader", "AtomicSpotRouter", "AtomicSpotModule"].includes(name) ? { registry: m.IntegrationRegistry } : {}),
          ...(name === "UseCaseReader" ? { programs: a.ReadProgram } : {}),
          ...(["UseCasePolicy", "UseCaseRecovery"].includes(name) ? { reader: a.UseCaseReader } : {}),
          ...(name === "AtomicSpotModule" ? { router: a.AtomicSpotRouter } : {}) };
    for (const [method, expected] of Object.entries(bindings)) equal(await read(name, address, method), expected, `${name}.${method}`);
  }
  equal((await client.getBlock({ blockNumber: block.number })).hash, block.hash, "canonical verification block");
  log(JSON.stringify({ verified: true, block: block.number.toString(), blockHash: block.hash,
    proxies: Object.keys(deployment.proxies[10143]).length, components: Object.keys(a).length }));
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Upgrade verification failed"); process.exitCode = 1; });
