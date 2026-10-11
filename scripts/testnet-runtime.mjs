import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

import { root, writeJsonAtomic, operationFile } from "./testnet-state.mjs";
export { root, writeJsonAtomic };
const require = createRequire(path.join(root, "packages/sdk/package.json"));
export const viem = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { createPublicClient, createWalletClient, http, keccak256, encodeDeployData, encodeFunctionData } = viem;
export const artifact = (name) => JSON.parse(fs.readFileSync(path.join(root, `contracts/evm/out/${name}.sol/${name}.json`), "utf8"));

export async function warmReadProgram(client, target, data) {
  const decoded = viem.decodeFunctionData({ abi: artifact("ReadProgram").abi, data });
  if (decoded.functionName !== "configure") return;
  const [id, program] = decoded.args;
  const info = await client.request({ method: "anvil_nodeInfo", params: [] });
  const fork = info.forkConfig;
  if (!fork?.forkUrl || !Number.isSafeInteger(fork.forkBlockNumber)) throw new Error("Simulation fork source unavailable");
  const source = createPublicClient({ transport: http(fork.forkUrl, { timeout: 30_000 }) });
  const request = { address: target, abi: artifact("ReadProgram").abi, functionName: "programHashes", args: [id] };
  const [current, original] = await Promise.all([client.readContract(request), source.readContract({ ...request, blockNumber: BigInt(fork.forkBlockNumber) })]);
  if (current !== original) return;
  const layout = artifact("ReadProgram").storageLayout;
  const mapping = layout.storage.find((field) => field.label === "programs");
  const base = BigInt(viem.keccak256(viem.encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, BigInt(mapping.slot)])));
  const members = layout.types[layout.types[mapping.type].value].members;
  const slots = new Set();
  const add = (slot) => slots.add(viem.toHex(slot, { size: 32 }));
  for (const member of members) {
    const slot = base + BigInt(member.slot); add(slot);
    const start = BigInt(viem.keccak256(viem.toHex(slot, { size: 32 })));
    const type = layout.types[member.type];
    const stride = Math.ceil(Number(layout.types[type.base].numberOfBytes) / 32);
    const count = member.label === "outputs" ? Math.ceil(program.outputs.length / 16) : program[member.label].length * stride;
    for (let i = 0; i < count; i++) add(start + BigInt(i));
    if (member.label !== "queries") continue;
    for (const [i, query] of program.queries.entries()) {
      const fields = layout.types[type.base].members;
      for (const field of fields.filter((f) => ["data", "arguments"].includes(f.label))) {
        const dynamic = BigInt(viem.keccak256(viem.toHex(start + BigInt(i * stride) + BigInt(field.slot), { size: 32 })));
        const length = field.label === "data" ? Math.ceil((query.data.length - 2) / 64) : query.arguments.length;
        for (let j = 0; j < length; j++) add(dynamic + BigInt(j));
      }
    }
  }
  await warmForkStorage(client, [...slots].map((slot) => ({ target, slot })));
}

export async function warmForkStorage(client, keys, onProgress) {
  const { forkConfig: fork } = await client.request({ method: "anvil_nodeInfo", params: [] });
  if (!fork?.forkUrl || !Number.isSafeInteger(fork.forkBlockNumber)) throw new Error("Simulation fork source unavailable");
  const source = createPublicClient({ transport: http(fork.forkUrl, { timeout: 30_000, retryCount: 0 }) });
  let completed = 0;
  const load = async (chunk) => {
    const body = JSON.stringify(chunk.map(({ target, slot }, id) => ({ jsonrpc: "2.0", id, method: "eth_getStorageAt", params: [target, slot, viem.toHex(fork.forkBlockNumber)] })));
    let values;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await globalThis.fetch(fork.forkUrl, { method: "POST", headers: { "content-type": "application/json" }, body,
          signal: globalThis.AbortSignal.timeout(30_000) });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result) || result.length !== chunk.length
          || new Set(result.map((item) => item?.id)).size !== chunk.length
          || result.some((item) => !Number.isInteger(item?.id) || item.id < 0 || item.id >= chunk.length)) throw new Error("Invalid storage response");
        values = result; break;
      } catch {
        if (attempt === 2) throw new Error("Simulation storage prefetch failed after three attempts");
        await delay(1000 * (attempt + 1));
      }
    }
    for (let group = 0; group < chunk.length; group += 8) await Promise.all(chunk.slice(group, group + 8).map(async ({ target, slot }, index) => {
      const i = group + index;
      let value = values.find((item) => item.id === i)?.result;
      for (let retry = 0; !/^0x[a-fA-F0-9]{1,64}$/.test(value ?? "") && retry < 3; retry++) {
        await delay(1000);
        value = await source.getStorageAt({ address: target, slot, blockNumber: BigInt(fork.forkBlockNumber) }).catch(() => undefined);
      }
      if (!/^0x[a-fA-F0-9]{1,64}$/.test(value ?? "")) throw new Error(`Simulation storage value unavailable (${values.find((item) => item.id === i)?.error?.code ?? "missing"})`);
      await client.request({ method: "anvil_setStorageAt", params: [target, slot, viem.toHex(BigInt(value), { size: 32 })] });
    }));
    completed += chunk.length;
    if (onProgress) await onProgress(completed, keys.length);
  };
  for (let offset = 0; offset < keys.length; offset += 32) {
    const batches = [];
    for (let start = offset; start < Math.min(offset + 32, keys.length); start += 8) batches.push(keys.slice(start, start + 8));
    await Promise.all(batches.map(load));
  }
}

export async function testnetRuntime(name, simulate) {
  if (!/^[a-z0-9-]+$/.test(name) || typeof simulate !== "boolean") throw new Error("Invalid runtime arguments");
  const override = process.env["TERMBOOK_SIMULATION_MANIFEST"];
  const manifestFile = override ? path.resolve(root, override) : path.join(root, "deployments/testnet.json");
  if (override && (!simulate || !manifestFile.startsWith(path.join(root, ".data/operations") + path.sep))) {
    throw new Error("Manifest override requires an isolated simulation file");
  }
  const deployment = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (deployment.network !== "testnet" || deployment.governanceDelaySeconds !== 0) throw new Error("Testnet deployment mismatch");
  const account = simulate ? deployment.deployer : privateKeyToAccount(JSON.parse(fs.readFileSync(path.join(root, ".testnet/evm.json"), "utf8")).privateKey);
  if (!simulate && account.address.toLowerCase() !== deployment.deployer.toLowerCase()) throw new Error("Wallet mismatch");
  const file = operationFile(`${name}${simulate ? "-simulation" : ""}`);
  const identity = `${deployment.sourceCommit}:${deployment.addresses[10143].TermbookCore}:${simulate}`;
  const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { identity, transactions: [], addresses: {}, governance: [] };
  if (report.identity !== identity) throw new Error("Runtime journal belongs to another deployment");
  const persist = () => writeJsonAtomic(file, report);
  const contexts = new Map();
  async function context(chainId) {
    if (contexts.has(chainId)) return contexts.get(chainId);
    if (![10143, 11155111].includes(chainId)) throw new Error("Unsupported testnet");
    const localOverride = simulate && chainId === 10143 ? process.env["TERMBOOK_SIMULATION_MONAD_RPC"] : undefined;
    if (localOverride) {
      const parsed = new URL(localOverride);
      if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)
        || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("Simulation RPC must be local");
    }
    const url = simulate ? localOverride ?? `http://127.0.0.1:${chainId === 10143 ? 18545 : 18546}`
      : chainId === 10143 ? "https://testnet-rpc.monad.xyz" : "https://ethereum-sepolia-rpc.publicnode.com";
    const client = createPublicClient({ transport: http(url, { timeout: 30_000 }) });
    if (await client.getChainId() !== chainId) throw new Error("Network mismatch");
    const wallet = createWalletClient({ account, transport: http(url, { timeout: 30_000 }) });
    if (simulate) {
      await client.request({ method: "anvil_impersonateAccount", params: [deployment.deployer] });
      await client.request({ method: "anvil_setBalance", params: [deployment.deployer, "0x204fce5e3e25026110000000"] });
    }
    async function send(label, data, to, value = 0n, blockNumber) {
      const inputHash = keccak256(data);
      let entry = report.transactions.find((tx) => tx.chainId === chainId && tx.name === label);
      if (entry && (entry.inputHash !== inputHash || entry.to !== to || entry.value !== value.toString())) throw new Error(`Transaction changed: ${label}`);
      if (entry?.status === "success") {
        const receipt = await client.getTransactionReceipt({ hash: entry.hash });
        if (receipt.status !== "success" || receipt.blockHash !== entry.blockHash) throw new Error(`Receipt changed: ${label}`);
        return entry;
      }
      if (entry?.status === "reverted") throw new Error(`Transaction reverted: ${label}`);
      if (simulate && entry && !entry.hash) throw new Error("Interrupted simulation requires journal reconciliation");
      if (!entry) {
        const estimate = await client.estimateGas({ account: deployment.deployer, data, to, value, blockNumber });
        const gas = estimate + estimate / 50n + 10_000n;
        if (chainId === 10143 && gas > 30_000_000n) throw new Error("Transaction exceeds Monad gas limit");
        let gasPrice = await client.getGasPrice();
        if (chainId === 10143 && gasPrice < 100_000_000_000n) gasPrice = 100_000_000_000n;
        if (chainId === 11155111) gasPrice += gasPrice / 4n;
        if (await client.getBalance({ address: deployment.deployer }) < gas * gasPrice + value + 10_000_000_000_000_000n) throw new Error("Insufficient testnet gas");
        const nonce = await client.getTransactionCount({ address: deployment.deployer, blockTag: "pending" });
        entry = { chainId, name: label, inputHash, to, value: value.toString(), nonce, gasLimit: gas.toString(), gasPrice: gasPrice.toString(), status: "prepared" };
        if (!simulate) {
          entry.rawTransaction = await wallet.signTransaction({ chain: null, chainId, data, to, value, gas, gasPrice, nonce, type: "legacy" });
          entry.hash = keccak256(entry.rawTransaction);
        }
        report.transactions.push(entry);
        persist();
        if (simulate) {
          entry.hash = await wallet.sendTransaction({ chain: null, data, to, value, gas, gasPrice, nonce });
          persist();
        }
      }
      const receipts = async () => {
        const candidates = [entry, ...(entry.replacements ?? [])];
        for (const candidate of candidates) {
          const receipt = await client.getTransactionReceipt({ hash: candidate.hash }).catch(() => null);
          if (receipt) return { receipt, candidate };
        }
        return null;
      };
      let mined = await receipts();
      if (!mined && !simulate && entry.status === "pending") {
        if (await client.getTransactionCount({ address: deployment.deployer }) > entry.nonce) throw new Error("Nonce consumed; reconcile the journal");
        const current = await client.getGasPrice();
        if (current > BigInt(entry.gasPrice)) {
          if ((entry.replacements?.length ?? 0) >= 3) throw new Error("Fee replacement limit reached");
          const minimum = BigInt(entry.gasPrice) * 5n / 4n + 1n;
          const price = current * 5n / 4n > minimum ? current * 5n / 4n : minimum;
          const gas = BigInt(entry.gasLimit);
          if (await client.getBalance({ address: deployment.deployer }) < gas * price + value + 10_000_000_000_000_000n) throw new Error("Insufficient replacement gas");
          const raw = await wallet.signTransaction({ chain: null, chainId, data, to, value, gas, gasPrice: price, nonce: entry.nonce, type: "legacy" });
          entry.replacements ??= [];
          entry.replacements.push({ hash: entry.hash, gasPrice: entry.gasPrice });
          Object.assign(entry, { rawTransaction: raw, hash: keccak256(raw), gasPrice: price.toString(), status: "prepared" });
          persist();
        }
      }
      if (!mined && !simulate) {
        await client.sendRawTransaction({ serializedTransaction: entry.rawTransaction }).catch(async () => {
          if (!await receipts() && !await client.getTransaction({ hash: entry.hash }).catch(() => null)) throw new Error(`Broadcast failed; resume journal: ${label}`);
        });
        entry.status = "pending";
        persist();
      }
      for (let attempt = 0; !mined && attempt < 60; attempt++) {
        await delay(1000);
        mined = await receipts();
      }
      if (!mined) throw new Error(`Receipt pending; resume journal: ${label}`);
      const { receipt, candidate } = mined;
      entry.hash = candidate.hash;
      entry.gasPrice = candidate.gasPrice;
      Object.assign(entry, { status: receipt.status, address: receipt.contractAddress, block: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
        gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString() });
      persist();
      if (receipt.status !== "success") throw new Error(`Transaction reverted: ${label}`);
      return entry;
    }
    const read = (name, address, functionName, args = []) => client.readContract({ address, abi: artifact(name).abi, functionName, args });
    const call = (name, address, functionName, args = [], label = `${name}.${functionName}`, blockNumber) =>
      send(label, encodeFunctionData({ abi: artifact(name).abi, functionName, args }), address, 0n, blockNumber);
    async function deploy(name, args, label = name) {
      const compiled = artifact(name);
      const entry = await send(label, encodeDeployData({ abi: compiled.abi, bytecode: compiled.bytecode.object, args }));
      const code = await client.getCode({ address: entry.address });
      if (!code || code === "0x" || entry.codeHash && entry.codeHash !== keccak256(code)) throw new Error(`Deployment changed: ${label}`);
      entry.codeHash = keccak256(code);
      report.addresses[label] = entry.address;
      persist();
      return entry.address;
    }
    async function govern(name, target, functionName, args) {
      return governData(target, encodeFunctionData({ abi: artifact(name).abi, functionName, args }), { name, functionName });
    }
    async function governData(target, data, description = {}) {
      if (!viem.isAddress(target) || !/^0x(?:[a-fA-F0-9]{2}){4,}$/.test(data)) throw new Error("Invalid governance call");
      if (simulate && target.toLowerCase() === deployment.addresses[chainId].ReadProgram?.toLowerCase()) await warmReadProgram(client, target, data);
      const governance = deployment.addresses[chainId].ProtocolGovernance;
      if (await read("ProtocolGovernance", governance, "timelock") !== 0n) throw new Error("Testnet delay changed");
      const salt = keccak256(data);
      const id = await read("ProtocolGovernance", governance, "actionId", [target, 0n, data, salt]);
      if (!await read("ProtocolGovernance", governance, "executed", [id])) {
        await call("ProtocolGovernance", governance, "queue", [target, 0n, data, salt], `queue:${id}`);
        const execution = await call("ProtocolGovernance", governance, "execute", [target, 0n, data, salt], `execute:${id}`);
        if (!await client.readContract({ address: governance, abi: artifact("ProtocolGovernance").abi,
          functionName: "executed", args: [id], blockNumber: BigInt(execution.block) })) throw new Error("Governance execution unavailable");
      }
      if (!report.governance.some((action) => action.id === id && action.chainId === chainId)) report.governance.push({ chainId, id, target, ...description });
      persist();
    }
    const logUrl = chainId === 10143 && process.env["TERMBOOK_CREDIT_RPC_URL"];
    const logClient = logUrl ? createPublicClient({ transport: http(logUrl, { timeout: 30_000 }) }) : client;
    const result = { client, logClient, read, call, deploy, govern, governData, send };
    contexts.set(chainId, result);
    return result;
  }
  return { deployment, report, persist, context, account };
}
