import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log } from "node:console";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { validateUpgradeArtifact, upgradeArtifactLoader } from "./upgrade-validation.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, "packages/sdk/package.json"));
const { createPublicClient, createWalletClient, http, encodeDeployData, encodeFunctionData,
  getContractAddress, keccak256, zeroAddress } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const [chainText, label, artifactName = label, mode = "--prepare", initialization = "0x"] = process.argv.slice(2);
const chainId = Number(chainText);
if (![10143, 11155111].includes(chainId) || !/^[A-Za-z][A-Za-z0-9]*$/.test(label ?? "")
  || !/^[A-Za-z][A-Za-z0-9]*$/.test(artifactName ?? "") || !["--prepare", "--broadcast"].includes(mode)
  || !/^0x(?:[0-9a-f]{2})*$/i.test(initialization) || process.argv.length > 7) {
  throw new Error("Usage: node scripts/upgrade-testnet.mjs <10143|11155111> <deployment-name> <artifact-name> <--prepare|--broadcast> [initialization-hex]");
}
const artifact = upgradeArtifactLoader(path.join(root, "contracts/evm/out"));
const manifestFile = path.join(root, "deployments/testnet.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const baseline = manifest.proxies?.[chainId]?.[label];
if (manifest.upgradeMode !== "testnet-administrator" || !baseline) throw new Error("Deploy the upgradeable testnet before preparing an upgrade");
const candidate = artifact(artifactName);
validateUpgradeArtifact(baseline, candidate);
const deploymentArgs = (candidate.abi.find((entry) => entry.type === "constructor")?.inputs ?? []).map((input) => {
  if (input.type === "address") return zeroAddress;
  if (/^bytes\d+$/.test(input.type)) return `0x${"00".repeat(Number(input.type.slice(5)))}`;
  if (/^u?int\d*$/.test(input.type)) return 0n;
  throw new Error("Unsupported implementation constructor");
});
const deploymentData = encodeDeployData({ abi: candidate.abi, bytecode: candidate.bytecode.object, args: deploymentArgs });
const expectedCodeHash = keccak256(candidate.deployedBytecode.object);
const proxy = manifest.addresses[chainId][label], controller = manifest.addresses[chainId].UpgradeController;
const governance = manifest.addresses[chainId].ProtocolGovernance;
const rpcUrl = process.env["TERMBOOK_UPGRADE_RPC_URL"]
  ?? (chainId === 10143 ? "https://testnet-rpc.monad.xyz" : "https://ethereum-sepolia-rpc.publicnode.com");
const client = createPublicClient({ transport: http(rpcUrl) });
if (await client.getChainId() !== chainId) throw new Error("Upgrade network mismatch");
const read = (name, address, functionName, args = []) => client.readContract({ address, abi: artifact(name).abi, functionName, args });
const directory = path.join(root, ".testnet/upgrades");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const journalFile = path.join(directory, `${chainId}-${label}-${keccak256(deploymentData).slice(2, 14)}.json`);
const journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, "utf8")) : { transactions: [] };
const persist = () => fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2), { mode: 0o600 });
const digest = keccak256(encodeFunctionData({ abi: artifact("UpgradeController").abi, functionName: "upgrade",
  args: [proxy, zeroAddress, expectedCodeHash, initialization] }));
if (journal.digest && journal.digest !== digest) throw new Error("Upgrade journal input mismatch");
if (journal.completed) { log(JSON.stringify({ status: "already-completed", proxy, implementation: journal.implementation })); process.exit(0); }
const current = await read("TestnetProxy", proxy, "proxyImplementation");
if (current.toLowerCase() !== baseline.implementation.toLowerCase()
  && current.toLowerCase() !== journal.implementation?.toLowerCase()) throw new Error("Upgrade baseline changed");
if (current.toLowerCase() === baseline.implementation.toLowerCase()
  && keccak256(await client.getCode({ address: current })) !== baseline.implementationCodeHash) throw new Error("Implementation code mismatch");
if ((await read("UpgradeController", controller, "owner")).toLowerCase() !== governance.toLowerCase()
  || await read("UpgradeController", controller, "contractIds", [proxy]) !== baseline.contractId) throw new Error("Upgrade controller mismatch");
journal.digest = digest;
journal.proxy = proxy;
journal.expectedCodeHash = expectedCodeHash;
const nonce = await client.getTransactionCount({ address: manifest.deployer, blockTag: "pending" });
if (!journal.transactions.length) journal.implementation = getContractAddress({ from: manifest.deployer, nonce: BigInt(nonce) });
const upgradeData = encodeFunctionData({ abi: artifact("UpgradeController").abi, functionName: "upgrade",
  args: [proxy, journal.implementation, expectedCodeHash, initialization] });
const salt = keccak256(upgradeData);
journal.deployment = { data: deploymentData, from: manifest.deployer };
journal.proposal = { to: governance, data: encodeFunctionData({ abi: artifact("ProtocolGovernance").abi,
  functionName: "queue", args: [controller, 0n, upgradeData, salt] }), value: "0" };
persist();
if (mode === "--prepare") {
  log(JSON.stringify({ status: "prepared", chainId, proxy, implementation: journal.implementation,
    storageCompatible: true, expectedCodeHash, planFile: journalFile, proposal: journal.proposal }));
  process.exit(0);
}
const account = privateKeyToAccount(JSON.parse(fs.readFileSync(path.join(root, ".testnet/evm.json"), "utf8")).privateKey);
if (account.address.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error("Upgrade deployment wallet mismatch");
const wallet = createWalletClient({ account, transport: http(rpcUrl) });
async function send(name, data, to) {
  let entry = journal.transactions.find((value) => value.name === name);
  if (entry && (entry.data !== data || entry.to !== to)) throw new Error("Signed upgrade input changed");
  if (!entry) {
    const estimate = await client.estimateGas({ account: account.address, to, data });
    const gas = estimate + estimate / 50n + 10_000n;
    if (chainId === 10143 && gas > 30_000_000n) throw new Error("Upgrade exceeds Monad gas limit");
    let gasPrice = await client.getGasPrice();
    if (chainId === 10143 && gasPrice < 100_000_000_000n) gasPrice = 100_000_000_000n;
    if (await client.getBalance({ address: account.address }) < gas * gasPrice) throw new Error("Insufficient upgrade gas balance");
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    if (!to && getContractAddress({ from: account.address, nonce: BigInt(nonce) }).toLowerCase() !== journal.implementation.toLowerCase()) {
      throw new Error("Implementation nonce changed; prepare a fresh upgrade before signing");
    }
    const raw = await wallet.signTransaction({ chain: null, chainId, to, data, gas, gasPrice, nonce, type: "legacy" });
    entry = { name, data, to, raw, hash: keccak256(raw) };
    journal.transactions.push(entry); persist();
  }
  let receipt = await client.getTransactionReceipt({ hash: entry.hash }).catch(() => null);
  if (!receipt) {
    try { await client.sendRawTransaction({ serializedTransaction: entry.raw }); }
    catch (error) {
      if (!await client.getTransaction({ hash: entry.hash }).catch(() => null)) throw error;
    }
    receipt = await client.waitForTransactionReceipt({ hash: entry.hash, timeout: 60_000 });
  }
  if (receipt.status !== "success") throw new Error(`Upgrade transaction reverted: ${name}`);
  entry.status = "success"; persist();
}
await send("implementation", deploymentData);
if (keccak256(await client.getCode({ address: journal.implementation })) !== expectedCodeHash
  || await read(artifactName, journal.implementation, "upgradeContractId") !== baseline.contractId) throw new Error("Candidate implementation mismatch");
const actionId = await read("ProtocolGovernance", governance, "actionId", [controller, 0n, upgradeData, salt]);
if (!await read("ProtocolGovernance", governance, "executed", [actionId])) {
  if (!await read("ProtocolGovernance", governance, "queuedAt", [actionId])) {
    if ((await read("ProtocolGovernance", governance, "governance")).toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`Approve the prepared governance proposal with the current governance owner: ${journalFile}`);
    }
    await send("queue", journal.proposal.data, governance);
  }
  const eta = await read("ProtocolGovernance", governance, "queuedAt", [actionId]);
  if ((await client.getBlock()).timestamp < eta) throw new Error(`Governance action is ready at Unix time ${eta}; resume afterwards`);
  await send("execute", encodeFunctionData({ abi: artifact("ProtocolGovernance").abi, functionName: "execute",
    args: [controller, 0n, upgradeData, salt] }), governance);
}
if (await read("TestnetProxy", proxy, "proxyImplementation") !== journal.implementation) throw new Error("Upgrade execution mismatch");
manifest.proxies[chainId][label] = { ...baseline, implementation: journal.implementation, implementationCodeHash: expectedCodeHash,
  storageLayout: candidate.storageLayout, abi: candidate.abi };
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
journal.completed = true; persist();
log(JSON.stringify({ status: "upgraded", chainId, proxy, implementation: journal.implementation }));
