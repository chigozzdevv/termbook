import fs from "node:fs";
import process from "node:process";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { upgradeArtifactLoader } from "./upgrade-validation.mjs";
import { verifySettledCredits } from "./testnet-replacement.mjs";
import { writeJsonAtomic } from "./testnet-runtime.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(root, "packages/sdk/package.json"));
const { createPublicClient, createWalletClient, http, encodeDeployData, encodeFunctionData,
  getContractAddress, keccak256, padHex, zeroAddress, formatEther } = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const broadcast = process.argv.includes("--broadcast");
const simulate = process.argv.includes("--simulate");
const activate = process.argv.includes("--activate");
const redeploy = process.argv.includes("--redeploy");
if (process.argv.slice(2).some((argument) => !["--broadcast", "--simulate", "--activate", "--redeploy"].includes(argument))) throw new Error("Unknown deployment argument");
if (broadcast === simulate) throw new Error("Use --simulate or --broadcast");
const directory = path.join(root, ".testnet");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const previousFile = path.join(root, "deployments/testnet-pre-upgrade.json");
if (redeploy && !fs.existsSync(previousFile)) {
  fs.copyFileSync(path.join(root, "deployments/testnet.json"), previousFile, fs.constants.COPYFILE_EXCL);
}
const previous = redeploy ? JSON.parse(fs.readFileSync(previousFile, "utf8")) : null;
for (const name of ["setup", "app", "keepers", "account-health", "e2e-verification"]) {
  const source = path.join(root, `deployments/testnet-${name}.json`);
  const archive = path.join(root, `deployments/testnet-pre-upgrade-${name}.json`);
  if (redeploy && fs.existsSync(source) && !fs.existsSync(archive)) fs.copyFileSync(source, archive, fs.constants.COPYFILE_EXCL);
}
const previousEvidenceFile = path.join(root, "deployments/testnet-pre-upgrade-e2e.json");
if (redeploy && !fs.existsSync(previousEvidenceFile) && fs.existsSync(path.join(root, "deployments/testnet-e2e.json"))) {
  fs.copyFileSync(path.join(root, "deployments/testnet-e2e.json"), previousEvidenceFile, fs.constants.COPYFILE_EXCL);
}
if (previous && previous.network !== "testnet") throw new Error("Replacement requires an existing testnet deployment");
const reportFile = path.join(directory, `${simulate ? "simulation" : "deployment"}-upgradeable${redeploy ? "-redeploy" : ""}.json`);
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8"))
  : { network: "testnet", upgradeMode: "testnet-administrator", proxies: {}, transactions: [], addresses: {}, pendingGovernance: [] };
if (report.upgradeMode !== "testnet-administrator") throw new Error("Legacy deployment journal; use a fresh replacement journal");
if (activate && !report.transactions.length) throw new Error("Deploy before activating governance actions");
const persist = () => writeJsonAtomic(reportFile, report);
function publishManifest() {
  if (!broadcast || !report.completedAt) return;
  const output = path.join(root, "deployments");
  fs.mkdirSync(output, { recursive: true });
  const manifest = {
    network: report.network, sourceCommit: report.sourceCommit, deployedAt: report.completedAt, deployer: report.deployer,
    recoveryRiskSigner: report.recoveryRiskSigner, addresses: report.addresses,
    governanceDelaySeconds: report.governanceDelaySeconds,
    previousDeployment: redeploy ? "testnet-pre-upgrade.json" : undefined,
    reusedContracts: report.reusedContracts,
    tokens: report.tokens, solana: report.solana, verification: report.verification,
    upgradeMode: report.upgradeMode, proxies: report.proxies,
    transactions: report.transactions.map((transaction) => Object.fromEntries(Object.entries(transaction).filter(([key]) => key !== "rawTransaction"))),
    governance: report.pendingGovernance,
  };
  fs.writeFileSync(path.join(output, "testnet.json"), JSON.stringify(manifest, null, 2) + "\n");
}
const account = privateKeyToAccount(simulate ? `0x${"1".padStart(64, "0")}`
  : JSON.parse(fs.readFileSync(path.join(directory, "evm.json"), "utf8")).privateKey);
if (report.deployer && report.deployer.toLowerCase() !== account.address.toLowerCase()) throw new Error("Deployment wallet mismatch");
if (previous && broadcast && previous.deployer.toLowerCase() !== account.address.toLowerCase()) throw new Error("Replacement wallet mismatch");
const riskFile = path.join(directory, "recovery-risk.json");
if (!activate && !fs.existsSync(riskFile)) fs.writeFileSync(riskFile, JSON.stringify({ privateKey: generatePrivateKey() }), { mode: 0o600 });
const riskSigner = activate ? report.recoveryRiskSigner : privateKeyToAccount(JSON.parse(fs.readFileSync(riskFile, "utf8")).privateKey).address;
if (report.recoveryRiskSigner && report.recoveryRiskSigner.toLowerCase() !== riskSigner.toLowerCase()) throw new Error("Recovery signer mismatch");
report.deployer = account.address;
report.recoveryRiskSigner = riskSigner;
report.sourceCommit ??= execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const abi = (name) => artifact(name).abi;
const artifact = upgradeArtifactLoader(path.join(root, "contracts/evm/out"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const upgradeAuthority = process.env["SOLANA_TESTNET_UPGRADE_AUTHORITY"];
if (upgradeAuthority && new PublicKey(upgradeAuthority).equals(PublicKey.default)) throw new Error("Invalid Solana upgrade authority");
const proxyNames = new Set(["FlowExecutor", "ReservationManager", "PriceProtection", "TermbookCore",
  "Guardian", "RiskEngine", "AccountFactory", "IntegrationRegistry", "HouseRegistry", "VerifierRegistry",
  "OracleRegistry", "HealthSource", "AccountHealthSource", "InboxFactory", "RouteRegistry", "HouseVault",
  "NativeCollateralVault", "SourceRecoveryVault", "RemoteCollateralController", "WormholeEthereumPublisher",
  "WormholeEvmMessageClient", "WormholeEthereumVerifier", "WormholeMonadVerifier",
  "WormholeSolanaAccountClient", "SolanaVerifier"]);
const zeroArgument = (input) => {
  if (input.type === "address") return zeroAddress;
  if (/^bytes\d+$/.test(input.type)) return `0x${"00".repeat(Number(input.type.slice(5)))}`;
  if (/^u?int\d*$/.test(input.type)) return 0n;
  throw new Error(`Unsupported implementation constructor: ${input.type}`);
};

async function context(chainId, url) {
  const parsed = new URL(url);
  if (simulate && parsed.hostname !== "127.0.0.1") throw new Error("Simulation requires local forks");
  const publicClient = createPublicClient({ transport: http(url, { timeout: 60_000 }) });
  if (await publicClient.getChainId() !== chainId) throw new Error(`Wrong chain: ${chainId}`);
  const wallet = createWalletClient({ account, transport: http(url, { timeout: 60_000 }) });
  if (simulate) await publicClient.request({ method: "anvil_setBalance", params: [account.address, "0x204fce5e3e25026110000000"] });
  report.addresses[chainId] ??= {};
  const addresses = report.addresses[chainId];
  const read = (name, address, functionName, args = []) => publicClient.readContract({ address, abi: abi(name), functionName, args });
  async function receipt(entry) {
    for (let attempt = 0; attempt < 120; attempt++) {
      for (const candidate of [entry, ...(entry.replacements ?? [])]) {
        const value = await publicClient.getTransactionReceipt({ hash: candidate.hash }).catch(() => null);
        if (value) return { result: value, hash: candidate.hash, gasPrice: candidate.gasPrice };
      }
      await delay(1000);
    }
    throw new Error(`Receipt pending; resume using the journal: ${entry.hash}`);
  }
  async function send(name, data, to) {
    const digest = keccak256(data);
    let entry = report.transactions.find((transaction) => transaction.chainId === chainId && transaction.name === name);
    if (entry && (entry.inputHash !== digest || entry.to !== to)) throw new Error(`Deployment inputs changed: ${name}`);
    if (!entry) {
      const estimate = await publicClient.estimateGas({ account: account.address, data, to });
      const margin = estimate + estimate / 50n + 10_000n;
      const gas = chainId === 10143 && margin > 30_000_000n ? 30_000_000n : margin;
      if (chainId === 10143 && estimate > gas) throw new Error(`${name} exceeds Monad transaction gas limit`);
      let gasPrice = await publicClient.getGasPrice();
      if (chainId === 10143 && gasPrice < 100_000_000_000n) gasPrice = 100_000_000_000n;
      if (chainId === 11155111) gasPrice += gasPrice / 4n;
      const balance = await publicClient.getBalance({ address: account.address });
      if (balance < gas * gasPrice + 10_000_000_000_000_000n) throw new Error(`Insufficient ${chainId} gas balance for ${name}`);
      const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
      const rawTransaction = await wallet.signTransaction({ chain: null, chainId, data, to, gas, gasPrice, nonce, type: "legacy" });
      const hash = keccak256(rawTransaction);
      entry = { chainId, name, inputHash: digest, to, hash, nonce, gasLimit: gas.toString(), gasPrice: gasPrice.toString(), rawTransaction, status: "prepared" };
      report.transactions.push(entry);
      persist();
    }
    if (entry.status === "pending") {
      const mined = (await Promise.all([entry, ...(entry.replacements ?? [])].map((candidate) =>
        publicClient.getTransactionReceipt({ hash: candidate.hash }).catch(() => null)))).some(Boolean);
      const currentPrice = mined ? 0n : await publicClient.getGasPrice();
      if (!mined && currentPrice > BigInt(entry.gasPrice)) {
        if ((entry.replacements?.length ?? 0) >= 3) throw new Error("Deployment fee replacement limit reached");
        if (await publicClient.getTransactionCount({ address: account.address }) > entry.nonce) throw new Error("Deployment nonce consumed; reconcile the journal before replacing");
        const gasPrice = currentPrice + currentPrice / 4n;
        const minimum = BigInt(entry.gasPrice) * 5n / 4n + 1n;
        const replacementPrice = gasPrice > minimum ? gasPrice : minimum;
        const gas = BigInt(entry.gasLimit);
        if (await publicClient.getBalance({ address: account.address }) < gas * replacementPrice + 10_000_000_000_000_000n) throw new Error("Insufficient deployment replacement balance");
        const rawTransaction = await wallet.signTransaction({ chain: null, chainId, data, to, gas, gasPrice: replacementPrice, nonce: entry.nonce, type: "legacy" });
        entry.replacements ??= [];
        entry.replacements.push({ hash: entry.hash, gasPrice: entry.gasPrice });
        Object.assign(entry, { hash: keccak256(rawTransaction), rawTransaction, gasPrice: replacementPrice.toString(), status: "prepared" });
        persist();
      }
    }
    if (entry.status === "prepared") {
      try {
        await publicClient.sendRawTransaction({ serializedTransaction: entry.rawTransaction });
      } catch (error) {
        const mined = (await Promise.all([entry, ...(entry.replacements ?? [])].map((candidate) =>
          publicClient.getTransactionReceipt({ hash: candidate.hash }).catch(() => null)))).some(Boolean);
        if (!mined && !await publicClient.getTransaction({ hash: entry.hash }).catch(() => null)) {
          throw new Error(`Broadcast failed; resume from the signed journal: ${entry.hash}. ${error.shortMessage ?? "RPC unavailable"}`, { cause: error });
        }
      }
      entry.status = "pending";
      persist();
    }
    if (entry.status !== "success") {
      const { result, hash, gasPrice } = await receipt(entry);
      Object.assign(entry, { hash, gasPrice, status: result.status, address: result.contractAddress,
        gasUsed: result.gasUsed.toString(), block: result.blockNumber.toString(), blockHash: result.blockHash });
      persist();
      if (entry.status !== "success") throw new Error(`Transaction reverted: ${name}`);
      log(JSON.stringify({ chainId, name, address: entry.address, hash: entry.hash, gasUsed: entry.gasUsed }));
    }
    return entry;
  }
  async function deploy(name, args = [], label = name, direct = false) {
    if (!direct && proxyNames.has(name)) {
      const controller = addresses["UpgradeController"];
      if (!controller) throw new Error("Deploy the upgrade controller first");
      const implementation = await deploy(name,
        (abi(name).find((entry) => entry.type === "constructor")?.inputs ?? []).map(zeroArgument), `${label}Implementation`, true);
      const initialization = encodeFunctionData({ abi: abi(name), functionName: "initialize", args });
      const proxy = await deploy("TestnetProxy", [implementation, controller, initialization], label, true);
      await call("UpgradeController", controller, "register", [proxy], `register:${label}`);
      report.proxies ??= {};
      report.proxies[chainId] ??= {};
      report.proxies[chainId][label] = { implementation, admin: await read("TestnetProxy", proxy, "proxyAdmin"),
        contractId: await read(name, implementation, "upgradeContractId"), implementationCodeHash: keccak256(await publicClient.getCode({ address: implementation })),
        storageLayout: artifact(name).storageLayout, abi: abi(name) };
      persist();
      return proxy;
    }
    const contract = artifact(name);
    report.artifactHashes ??= {};
    const artifactHash = keccak256(contract.bytecode.object);
    if (report.artifactHashes[name] && report.artifactHashes[name] !== artifactHash) throw new Error(`Deployment build changed: ${name}`);
    report.artifactHashes[name] = artifactHash;
    const entry = await send(label, encodeDeployData({ abi: contract.abi, bytecode: contract.bytecode.object, args }));
    if (!entry.address) throw new Error(`Missing deployed address: ${label}`);
    const code = await publicClient.getCode({ address: entry.address });
    if (!code || code === "0x") throw new Error(`Missing deployed code: ${label}`);
    const hash = keccak256(code);
    if (entry.codeHash && entry.codeHash !== hash) throw new Error(`Deployed code changed: ${label}`);
    entry.codeHash = hash;
    addresses[label] = entry.address;
    persist();
    return entry.address;
  }
  const call = (name, address, functionName, args = [], label = `${name}.${functionName}`) =>
    send(label, encodeFunctionData({ abi: abi(name), functionName, args }), address);
  async function queue(governance, target, name, functionName, args = []) {
    const data = encodeFunctionData({ abi: abi(name), functionName, args });
    const salt = keccak256(data);
    const label = `queue:${name}.${functionName}:${salt}`;
    await call("ProtocolGovernance", governance, "queue", [target, 0n, data, salt], label);
    const id = await read("ProtocolGovernance", governance, "actionId", [target, 0n, data, salt]);
    const eta = await read("ProtocolGovernance", governance, "queuedAt", [id]);
    if (!report.pendingGovernance.some((action) => action.chainId === chainId && action.id === id)) {
      report.pendingGovernance.push({ chainId, governance, target, name, functionName, data, salt, id, eta: eta.toString() });
      persist();
    }
  }
  return { publicClient, addresses, read, deploy, call, queue };
}

const program = process.env["SOLANA_PROGRAM_ID"] ? new PublicKey(process.env["SOLANA_PROGRAM_ID"])
  : Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(root, "contracts/solana/target/deploy/sol_collateral-keypair.json"), "utf8")))).publicKey;
const solanaHex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const genesis = solanaHex(new PublicKey("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG").toBytes());
const programId = solanaHex(program.toBytes());
const emitter = solanaHex(PublicKey.findProgramAddressSync([Buffer.from("emitter")], program)[0].toBytes());
const programHash = keccak256(solanaHex(fs.readFileSync(path.join(root, "contracts/solana/target/testnet/deploy/sol_collateral.so"))));
if (broadcast) {
  const solana = new Connection("https://api.devnet.solana.com", "finalized");
  if (await solana.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Solana network mismatch");
  const deployed = await solana.getAccountInfo(program);
  const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
  if (!deployed?.executable || deployed.owner.toBase58() !== loader || deployed.data.length !== 36 || deployed.data.readUInt32LE(0) !== 2) throw new Error("Solana program unavailable");
  const programData = await solana.getAccountInfo(new PublicKey(deployed.data.subarray(4, 36)));
  if (!programData || programData.executable || programData.owner.toBase58() !== loader
    || programData.data.length <= 45 || programData.data.readUInt32LE(0) !== 3
    || programData.data[12] > 1 || (programData.data[12] === 1 && (!upgradeAuthority
      || new PublicKey(programData.data.subarray(13, 45)).toBase58() !== upgradeAuthority))
    || keccak256(solanaHex(programData.data.subarray(45))) !== programHash) throw new Error("Solana admitted binary or upgrade authority mismatch");
  report.solana = { ...previous?.solana, network: "devnet", genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    programId: program.toBase58(), programDataAddress: new PublicKey(deployed.data.subarray(4, 36)).toBase58(),
    programDataHash: programHash, emitter: PublicKey.findProgramAddressSync([Buffer.from("emitter")], program)[0].toBase58(),
    immutable: programData.data[12] === 0, upgradeAuthority: programData.data[12] === 1 ? upgradeAuthority : undefined };
  if (previous?.solana.programId !== program.toBase58()) {
    delete report.solana.deploymentSignature;
    const receiptFile = path.join(directory, "solana-upgradeable-deployment.json");
    if (fs.existsSync(receiptFile)) {
      const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
      if (receipt.programId !== program.toBase58() || receipt.programDataHash !== programHash) throw new Error("Solana deployment receipt mismatch");
      report.solana.deploymentSignature = receipt.deploymentSignature;
    }
  }
}

const monad = await context(10143, simulate ? "http://127.0.0.1:18545" : "https://testnet-rpc.monad.xyz");
const ethereum = await context(11155111, simulate ? "http://127.0.0.1:18546" : "https://ethereum-sepolia-rpc.publicnode.com");
if (previous) {
  report.previousCredits = await verifySettledCredits(previous,
    fs.existsSync(previousEvidenceFile) ? JSON.parse(fs.readFileSync(previousEvidenceFile, "utf8")) : null,
    (chainId, name, address, method, args = []) => (chainId === 10143 ? monad : ethereum).read(name, address, method, args));
  const balance = await monad.publicClient.readContract({
    address: previous.tokens[10143].USDC,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf", args: [previous.addresses[10143].HouseVault],
  });
  if (balance !== 0n) throw new Error("Replacement requires migration of existing House liquidity");
  if (broadcast && !activate && report.transactions.length === 0) {
    const planFile = path.join(directory, "simulation-upgradeable-redeploy.json");
    if (!fs.existsSync(planFile)) throw new Error("Simulate the replacement before broadcasting");
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    if (!plan.completedAt || plan.governanceDelaySeconds !== 0 || plan.pendingGovernance.length !== 13
      || plan.pendingGovernance.some((action) => action.status !== "executed") || !plan.artifactHashes) {
      throw new Error("Complete the replacement deployment and activation simulation first");
    }
    for (const [name, expected] of Object.entries(plan.artifactHashes)) {
      if (keccak256(artifact(name).bytecode.object) !== expected) throw new Error(`Simulation build changed: ${name}`);
    }
    const solanaBinary = fs.readFileSync(path.join(root, "contracts/solana/target/testnet/deploy/sol_collateral.so"));
    if (!upgradeAuthority && keccak256(`0x${solanaBinary.toString("hex")}`) !== previous.solana.programDataHash) throw new Error("Solana replacement binary mismatch");
    const funding = [];
    for (const [context, chainId] of [[monad, 10143], [ethereum, 11155111]]) {
      let gasPrice = await context.publicClient.getGasPrice();
      if (chainId === 10143 && gasPrice < 100_000_000_000n) gasPrice = 100_000_000_000n;
      if (chainId === 11155111) gasPrice += gasPrice / 4n;
      const gas = plan.transactions.filter((transaction) => transaction.chainId === chainId)
        .reduce((sum, transaction) => sum + BigInt(transaction.gasLimit), 0n);
      const required = gas * gasPrice + 10_000_000_000_000_000n;
      const available = await context.publicClient.getBalance({ address: account.address });
      funding.push({ chainId, required: formatEther(required), available: formatEther(available),
        missing: formatEther(required > available ? required - available : 0n) });
    }
    if (funding.some((entry) => entry.missing !== "0")) {
      log(JSON.stringify({ status: "funding-required", wallet: account.address, funding }));
      process.exit(2);
    }
  }
}
async function activateGovernance() {
  for (const action of report.pendingGovernance) {
    const context = action.chainId === 10143 ? monad : action.chainId === 11155111 ? ethereum : null;
    if (!context) throw new Error("Governance network mismatch");
    const id = await context.read("ProtocolGovernance", action.governance, "actionId", [action.target, 0n, action.data, action.salt]);
    if (id !== action.id) throw new Error("Governance action mismatch");
    if (await context.read("ProtocolGovernance", action.governance, "executed", [id])) {
      action.status = "executed";
      persist();
      continue;
    }
    const eta = await context.read("ProtocolGovernance", action.governance, "queuedAt", [id]);
    if (eta === 0n || eta.toString() !== action.eta) throw new Error("Governance action changed or cancelled");
    if ((await context.publicClient.getBlock()).timestamp < eta) {
      log(JSON.stringify({ chainId: action.chainId, name: action.name, status: "timelocked", readyAt: new Date(Number(eta) * 1000).toISOString() }));
      continue;
    }
    await context.call("ProtocolGovernance", action.governance, "execute", [action.target, 0n, action.data, action.salt], `execute:${id}`);
    if (!await context.read("ProtocolGovernance", action.governance, "executed", [id])) throw new Error("Governance execution unavailable");
    action.status = "executed";
    persist();
  }
  log(JSON.stringify({ executed: report.pendingGovernance.filter((action) => action.status === "executed").length, total: report.pendingGovernance.length }));
}
async function verifyDeployment() {
  const equal = (actual, expected, label) => {
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`Deployment verification failed: ${label}`);
  };
  let proxyCount = 0;
  const finality = {};
  for (const [network, chainId] of [[monad, 10143], [ethereum, 11155111]]) {
    const addresses = report.addresses[chainId];
    const controller = addresses.UpgradeController;
    equal(await network.read("ProtocolGovernance", addresses.ProtocolGovernance, "governance"), account.address, "governance owner");
    equal(await network.read("ProtocolGovernance", addresses.ProtocolGovernance, "timelock"), 0n, "testnet delay");
    equal(await network.read("UpgradeController", controller, "owner"), addresses.ProtocolGovernance, "upgrade owner");
    for (const [name, pin] of Object.entries(report.proxies[chainId])) {
      const proxy = addresses[name];
      equal(await network.read("TestnetProxy", proxy, "proxyImplementation"), pin.implementation, `${name} implementation`);
      equal(await network.read("TestnetProxy", proxy, "proxyAdmin"), pin.admin, `${name} administrator`);
      equal(await network.read("ProxyAdmin", pin.admin, "owner"), controller, `${name} administrator owner`);
      equal(await network.read("UpgradeController", controller, "contractIds", [proxy]), pin.contractId, `${name} identity`);
      equal(keccak256(await network.publicClient.getCode({ address: pin.implementation })), pin.implementationCodeHash, `${name} code`);
      proxyCount++;
    }
    const finalized = await network.publicClient.getBlock({ blockTag: "finalized" });
    const transactions = report.transactions.filter((tx) => tx.chainId === chainId);
    for (const tx of transactions) {
      const receipt = await network.publicClient.getTransactionReceipt({ hash: tx.hash });
      equal(receipt.status, "success", `${tx.name} receipt`);
      equal(receipt.blockHash, tx.blockHash, `${tx.name} canonical block`);
    }
    finality[chainId] = { finalizedBlock: finalized.number.toString(), transactions: transactions.length,
      finalizedTransactions: transactions.filter((tx) => BigInt(tx.block) <= finalized.number).length };
  }
  const m = report.addresses[10143];
  const s = report.addresses[11155111];
  for (const [method, expected] of [["riskEngine", m.RiskEngine], ["guardian", m.Guardian],
    ["healthSource", m.AccountHealthSource], ["houseRegistry", m.HouseRegistry],
    ["integrationRegistry", m.IntegrationRegistry], ["verifierRegistry", m.VerifierRegistry]]) {
    equal(await monad.read("TermbookCore", m.TermbookCore, method), expected, method);
  }
  equal(await monad.read("RiskEngine", m.RiskEngine, "core"), m.TermbookCore, "risk core");
  equal(await monad.read("RiskEngine", m.RiskEngine, "protocolFloorBps"), 11_000n, "risk floor");
  equal(await monad.read("Guardian", m.Guardian, "governance"), m.ProtocolGovernance, "guardian governance");
  equal(await monad.read("HouseRegistry", m.HouseRegistry, "isActiveHouse", [account.address, m.HouseVault]), true, "House admission");
  equal(await ethereum.read("RemoteCollateralController", s.RemoteCollateralController, "vault"), s.CollateralVault, "source custody");
  equal(await ethereum.read("RemoteCollateralController", s.RemoteCollateralController, "monadCore"), m.TermbookCore, "source Core");
  equal(await ethereum.read("SourceRecoveryVault", s.SourceRecoveryVault, "controller"), s.RemoteCollateralController, "source recovery");
  report.verification = { checkedAt: new Date().toISOString(), proxyCount, finality,
    governanceActionsExecuted: report.pendingGovernance.filter((action) => action.status === "executed").length };
  persist();
  log(JSON.stringify(report.verification));
}
if (activate) {
  await activateGovernance();
  await verifyDeployment();
  publishManifest();
  process.exit(0);
}
const monadWormhole = "0xaBf89de706B583424328B54dD05a8fC986750Da8";
const ethereumWormhole = "0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78";
const usdc = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const wrappedMon = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const weth = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
for (const [context, wormhole, expected] of [[monad, monadWormhole, 10009], [ethereum, ethereumWormhole, 10002]]) {
  if (await context.read("IWormholeCore", wormhole, "chainId") !== expected) throw new Error("Wormhole network mismatch");
}
for (const [context, token] of [[monad, usdc], [monad, wrappedMon], [ethereum, weth]]) {
  const code = await context.publicClient.getCode({ address: token });
  if (!code || code === "0x") throw new Error(`Token contract unavailable: ${token}`);
}
const governance = await monad.deploy("ProtocolGovernance", [account.address, 0n]);
if (await monad.read("ProtocolGovernance", governance, "timelock") !== 0n) throw new Error("Testnet governance delay mismatch");
report.governanceDelaySeconds = 0;
persist();
const upgrades = await monad.deploy("UpgradeController", [account.address]);
const guardian = await monad.deploy("Guardian", [account.address, governance]);
const houses = await monad.deploy("HouseRegistry", [governance]);
const verifiers = await monad.deploy("VerifierRegistry", [governance]);
if (!report.predictedCore) {
  const nonce = await monad.publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  report.predictedCore = getContractAddress({ from: account.address, nonce: BigInt(nonce + 10) });
  persist();
}
const execution = await monad.deploy("FlowExecutor", [report.predictedCore]);
const reservations = await monad.deploy("ReservationManager", [report.predictedCore]);
const prices = await monad.deploy("PriceProtection", [report.predictedCore]);
const core = await monad.deploy("TermbookCore", [account.address, guardian, zeroAddress, execution, reservations, prices]);
if (core.toLowerCase() !== report.predictedCore.toLowerCase()) throw new Error("Core nonce mismatch");
for (const [name, helper] of [["FlowExecutor", execution], ["ReservationManager", reservations], ["PriceProtection", prices]]) {
  if ((await monad.read(name, helper, "core")).toLowerCase() !== core.toLowerCase()) throw new Error("Core helper binding mismatch");
}
const risk = await monad.deploy("RiskEngine", [core]);
const accounts = await monad.deploy("AccountFactory");
const integrations = await monad.deploy("IntegrationRegistry", [governance]);
const factory = await monad.deploy("InboxFactory", [governance]);
const oracles = await monad.deploy("OracleRegistry", [governance]);
const health = await monad.deploy("HealthSource", [governance, oracles]);
const authenticatedHealth = await monad.deploy("AccountHealthSource", [core, health, accounts]);
await monad.call("TermbookCore", core, "setRisk", [risk]);
await monad.call("TermbookCore", core, "setIntegrationRegistry", [integrations]);
await monad.call("TermbookCore", core, "setHouseRegistry", [houses]);
await monad.call("TermbookCore", core, "setVerifierRegistry", [verifiers]);
await monad.call("TermbookCore", core, "setHealthSource", [authenticatedHealth]);
await monad.call("TermbookCore", core, "setGovernance", [governance]);
const house = await monad.deploy("HouseVault", [usdc, core, account.address, factory, guardian]);
const routes = await monad.deploy("RouteRegistry", [governance]);
await monad.deploy("NativeCollateralVault", [wrappedMon, 10143n, core]);
await monad.deploy("CollateralHealthReader", [core, governance, oracles]);
const sourceGovernance = await ethereum.deploy("ProtocolGovernance", [account.address, 0n]);
const sourceUpgrades = await ethereum.deploy("UpgradeController", [account.address]);
if (await ethereum.read("ProtocolGovernance", sourceGovernance, "timelock") !== 0n) throw new Error("Source governance delay mismatch");
const authorization = await ethereum.deploy("WormholeEvmMessageClient", [ethereumWormhole, 10002, 10009, 10143n, 1n, padHex(core, { size: 32 }), 7200n], "AuthorizationClient");
const recoveryClient = await ethereum.deploy("WormholeEvmMessageClient", [ethereumWormhole, 10002, 10009, 10143n, 1n, padHex(factory, { size: 32 }), 7200n], "RecoveryClient");
const monadVerifier = await ethereum.deploy("WormholeMonadVerifier", [authorization, recoveryClient, core, factory]);
const recovery = await ethereum.deploy("SourceRecoveryVault", [weth, 10143n, factory, monadVerifier, sourceGovernance, account.address, riskSigner]);
const controller = await ethereum.deploy("RemoteCollateralController", [weth, 10143n, core, recovery, monadVerifier, sourceGovernance, account.address]);
const vault = await ethereum.read("RemoteCollateralController", controller, "vault");
ethereum.addresses.CollateralVault = vault;
const publisher = await ethereum.deploy("WormholeEthereumPublisher", [vault, controller, ethereumWormhole]);
const ethereumClient = await monad.deploy("WormholeEvmMessageClient", [monadWormhole, 10009, 10002, 11155111n, 1n, padHex(publisher, { size: 32 }), 7200n]);
const sourceHash = async (address) => keccak256(await ethereum.publicClient.getCode({ address }));
const ethereumVerifier = await monad.deploy("WormholeEthereumVerifier", [ethereumClient, publisher, await sourceHash(publisher), vault, await sourceHash(vault), controller, await sourceHash(controller)]);
const solanaClient = await monad.deploy("WormholeSolanaAccountClient", [monadWormhole, 501n, 1n, genesis, programId, emitter, programHash, 7200n]);
const solanaVerifier = await monad.deploy("SolanaVerifier", [solanaClient, genesis, programId, programHash]);
for (const [network, controller, authority] of [[monad, upgrades, governance], [ethereum, sourceUpgrades, sourceGovernance]]) {
  await network.call("UpgradeController", controller, "transferOwnership", [authority]);
  await network.queue(authority, controller, "UpgradeController", "acceptOwnership");
}
report.upgradeMode = "testnet-administrator";
await monad.call("ProtocolGovernance", governance, "addCore", [core]);
await ethereum.queue(sourceGovernance, recovery, "SourceRecoveryVault", "setController", [controller]);
await monad.queue(governance, factory, "InboxFactory", "setRouteRegistry", [routes]);
await monad.queue(governance, factory, "InboxFactory", "configureEthereumWormhole", [monadWormhole]);
await monad.queue(governance, core, "TermbookCore", "configureEthereumWormhole", [monadWormhole]);
await monad.queue(governance, core, "TermbookCore", "configureSolanaWormhole", [monadWormhole]);
await monad.queue(governance, verifiers, "VerifierRegistry", "setVerifier", [11155111n, ethereumVerifier, 1n, 7200n]);
await monad.queue(governance, verifiers, "VerifierRegistry", "setVerifier", [501n, solanaVerifier, 1n, 7200n]);
await monad.queue(governance, houses, "HouseRegistry", "register", [account.address, house, usdc, account.address]);
await monad.queue(governance, core, "TermbookCore", "setSourceCollateralVault", [11155111n, weth, vault]);
await monad.queue(governance, core, "TermbookCore", "setSourceRecoveryVault", [11155111n, weth, recovery]);
await monad.queue(governance, core, "TermbookCore", "setSolanaMarket", [501n, genesis, programId, programHash]);
await activateGovernance();
if (report.pendingGovernance.some((action) => action.status !== "executed")) throw new Error("Testnet activation incomplete");
await verifyDeployment();
report.completedAt ??= new Date().toISOString();
report.tokens = { "10143": { USDC: usdc, WMON: wrappedMon }, "11155111": { WETH: weth } };
for (const chainId of [10143, 11155111]) {
  const entries = report.transactions.filter((transaction) => transaction.chainId === chainId);
  log(JSON.stringify({ chainId, transactions: entries.length, gasBudget: entries.reduce((sum, transaction) => sum + BigInt(transaction.gasLimit), 0n).toString(),
    nativeCost: formatEther(entries.reduce((sum, transaction) => sum + BigInt(transaction.gasLimit) * BigInt(transaction.gasPrice), 0n)) }));
}
persist();
publishManifest();
