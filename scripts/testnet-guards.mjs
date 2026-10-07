import fs from "node:fs";
import path from "node:path";
import { root, viem } from "./testnet-runtime.mjs";

export async function reuseGuard(runtime, network, recordName, label, contract, dependency, implementation, getter, libraries = []) {
  const file = path.join(root, `deployments/testnet-pre-upgrade-${recordName}.json`);
  if (!fs.existsSync(file)) return null;
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  const address = previous.addresses?.[label];
  const pin = previous.transactions?.find((tx) => tx.name === label && tx.address === address && tx.status === "success");
  if (!address || !pin?.codeHash) throw new Error(`Missing previous guard evidence: ${label}`);
  const code = await network.client.getCode({ address });
  if (!code || viem.keccak256(code) !== pin.codeHash) throw new Error(`Previous guard code changed: ${label}`);
  for (const [method, expected] of [["proxy", dependency], ["implementation", implementation], ["getter", getter]]) {
    if (String(await network.read(contract, address, method)).toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Previous guard binding changed: ${label}`);
    }
  }
  if (!await network.read(contract, address, "valid", [dependency])) throw new Error(`Previous guard is invalid: ${label}`);
  if (libraries.length) {
    if (await network.read(contract, address, "libraryCount") !== BigInt(libraries.length)) throw new Error("Previous guard libraries changed");
    for (const [index, library] of libraries.entries()) {
      if (String(await network.read(contract, address, "libraryAt", [BigInt(index)])).toLowerCase() !== library.toLowerCase()) {
        throw new Error("Previous guard libraries changed");
      }
    }
  }
  runtime.report.addresses[label] = address;
  runtime.report.reusedContracts ??= [];
  if (!runtime.report.reusedContracts.some((entry) => entry.name === label)) {
    runtime.report.reusedContracts.push({ chainId: 10143, name: label, address, codeHash: pin.codeHash });
  }
  runtime.persist();
  return address;
}
