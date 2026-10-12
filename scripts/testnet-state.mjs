import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import process from "node:process";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const manifestFile = path.join(root, "deployments/testnet.json");
export const operations = path.join(root, ".data/operations");

export async function canonicalReceipt(client, hash) {
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt || receipt.blockHash === `0x${"0".repeat(64)}`) return null;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || block.transactions[receipt.transactionIndex] !== hash) {
    throw new Error("Transaction receipt is not canonical");
  }
  return receipt;
}

export function writeJsonAtomic(file, value) {
  const body = JSON.stringify(value, null, 2) + "\n";
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, body);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function operationFile(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error("Invalid operation name");
  fs.mkdirSync(operations, { recursive: true, mode: 0o700 });
  return path.join(operations, `${name}.json`);
}

export function operationLock(name) {
  return operationFile(name).replace(/\.json$/, ".lock");
}

const runFields = new Set(["transactions", "solanaTransactions", "rawTransaction", "governance", "topups",
  "preserved", "verification", "finalizedVerification", "originalHouseAccounting", "readiness", "reusedContracts",
  "previousDeployment", "runtime", "upgrades", "previousImplementation", "deploymentReport"]);
export function configuration(value) {
  if (Array.isArray(value)) return value.map(configuration);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !runFields.has(key)).map(([key, item]) => {
    if (/privateKey|secretKey|mnemonic|password|apiKey/i.test(key)) throw new Error("Private data cannot enter the deployment manifest");
    return [key, configuration(item)];
  }));
}

export function readConfiguration(name, deployment = JSON.parse(fs.readFileSync(manifestFile, "utf8"))) {
  const result = deployment.configuration?.[name];
  if (!result) throw new Error(`Missing testnet configuration: ${name}`);
  return result;
}

export function writeConfiguration(name, value) {
  const deployment = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const pins = Object.fromEntries((value.transactions ?? []).filter((tx) => tx.address && tx.codeHash && tx.status === "success")
    .map((tx) => [tx.name, { address: tx.address, codeHash: tx.codeHash }]));
  for (const tx of value.reusedContracts ?? []) if (tx.address && tx.codeHash) pins[tx.name] = { address: tx.address, codeHash: tx.codeHash };
  deployment.configuration ??= {};
  deployment.configuration[name] = { core: deployment.addresses[10143].TermbookCore, ...configuration(value),
    ...(Object.keys(pins).length ? { contractPins: pins } : {}) };
  writeJsonAtomic(manifestFile, deployment);
}

export function alreadyConfigured(name) {
  if (!fs.existsSync(manifestFile)) return false;
  const deployment = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const value = deployment.configuration?.[name];
  return Boolean(value?.completedAt && value.core?.toLowerCase() === deployment.addresses[10143].TermbookCore.toLowerCase());
}

export function clearOperation(name, simulate = false) {
  const file = operationFile(`${name}${simulate ? "-simulation" : ""}`);
  fs.rmSync(file, { force: true });
  if (!simulate) fs.rmSync(operationFile(`${name}-simulation`), { force: true });
}
