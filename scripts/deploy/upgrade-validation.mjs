import { createRequire } from "node:module";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { assertStorageUpgradeSafe } from "@openzeppelin/upgrades-core";

const require = createRequire(new URL("../../packages/sdk/package.json", import.meta.url));
const { toFunctionSelector, toEventSelector } = require("viem");
const reserved = new Set([toFunctionSelector("proxyImplementation()"), toFunctionSelector("proxyAdmin()"), toFunctionSelector("upgradeToAndCall(address,bytes)")]);

export function withEnumMembers(artifact, sources) {
  if (!artifact.storageLayout) return artifact;
  const layout = globalThis.structuredClone(artifact.storageLayout);
  const enums = Object.values(layout.types ?? {}).filter((type) => type.label.startsWith("enum "));
  if (!enums.length) return artifact;
  for (const source of sources) {
    const sourcePath = source.ast?.absolutePath;
    const expected = artifact.metadata?.sources?.[sourcePath]?.keccak256;
    if (!expected || expected !== source.metadata?.sources?.[sourcePath]?.keccak256) continue;
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.nodeType === "EnumDefinition") {
        for (const type of enums.filter((type) => type.label === `enum ${node.canonicalName}`)) {
          type.members = node.members.map((member) => member.name);
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    };
    visit(source.ast);
  }
  if (enums.some((type) => !type.members?.length)) throw new Error("Missing enum storage metadata; rebuild with AST output");
  return { ...artifact, storageLayout: layout };
}

export function upgradeArtifactLoader(directory) {
  let sources;
  return (name) => {
    let file = path.join(directory, `${name}.sol/${name}.json`);
    if (!fs.existsSync(file)) {
      const matches = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith(".sol"))
        .map((entry) => path.join(directory, entry.name, `${name}.json`)).filter((file) => fs.existsSync(file));
      if (matches.length !== 1) throw new Error(`Missing or ambiguous implementation artifact: ${name}`);
      file = matches[0];
    }
    const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Object.values(artifact.storageLayout?.types ?? {}).some((type) => type.label.startsWith("enum "))) return artifact;
    sources ??= fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".sol"))
      .flatMap((entry) => {
        const folder = path.join(directory, entry.name);
        const file = fs.readdirSync(folder).find((file) => file.endsWith(".json"));
        return file ? [JSON.parse(fs.readFileSync(path.join(folder, file), "utf8"))] : [];
      });
    return withEnumMembers(artifact, sources);
  };
}

export function validateUpgradeArtifact(previous, next) {
  if (!previous?.storageLayout?.types || !next?.storageLayout?.types
    || !Array.isArray(previous.abi) || !Array.isArray(next.abi)) throw new Error("Missing upgrade baseline");
  assertStorageUpgradeSafe(previous.storageLayout, next.storageLayout, false);
  const functions = next.abi.filter((entry) => entry.type === "function");
  for (const entry of functions) {
    if (reserved.has(toFunctionSelector(entry))) throw new Error("Proxy selector collision");
  }
  for (const entry of previous.abi.filter((entry) => entry.type === "function")) {
    const match = functions.find((candidate) => toFunctionSelector(candidate) === toFunctionSelector(entry));
    const types = (items) => items.map((item) => ({ type: item.type,
      ...(item.components ? { components: types(item.components) } : {}) }));
    if (!match || JSON.stringify(types(entry.outputs)) !== JSON.stringify(types(match.outputs))
      || entry.stateMutability !== match.stateMutability) throw new Error(`Incompatible function: ${entry.name}`);
  }
  for (const entry of previous.abi.filter((entry) => entry.type === "event")) {
    const match = next.abi.find((candidate) => candidate.type === "event" && toEventSelector(candidate) === toEventSelector(entry));
    if (!match || entry.anonymous !== match.anonymous
      || JSON.stringify(entry.inputs.map((input) => input.indexed)) !== JSON.stringify(match.inputs.map((input) => input.indexed))) {
      throw new Error(`Incompatible event: ${entry.name}`);
    }
  }
  const bytecode = next.bytecode?.object;
  const runtime = next.deployedBytecode?.object;
  if (!/^0x[0-9a-f]+$/i.test(bytecode ?? "") || !/^0x[0-9a-f]+$/i.test(runtime ?? "")
    || Object.keys(next.deployedBytecode?.immutableReferences ?? {}).length) throw new Error("Unresolved implementation bytecode");
}
