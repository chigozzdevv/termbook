import { loadCredits } from "./testnet-credits.mjs";
import { alreadyConfigured, writeConfiguration, clearOperation, operationFile } from "./testnet-state.mjs";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { execFileSync } from "node:child_process";
import { root, viem, artifact, testnetRuntime, writeJsonAtomic } from "./testnet-runtime.mjs";
import { validateUpgradeArtifact, upgradeArtifactLoader } from "./upgrade-validation.mjs";
import { executionKey } from "../packages/schema/dist/index.js";

const simulate = process.argv[2] === "--simulate";
const refreshSpot = process.argv[3] === "--refresh-spot";
const refreshOrders = process.argv[3] === "--refresh-orders";
const refreshReaders = process.argv[3] === "--refresh-readers";
const refreshPrices = process.argv[3] === "--refresh-prices";
if (!["--simulate", "--broadcast"].includes(process.argv[2]) || process.argv.length !== (refreshSpot || refreshPrices || refreshOrders || refreshReaders ? 4 : 3)) {
  throw new Error("Use --simulate or --broadcast, optionally with --refresh-spot, --refresh-prices, --refresh-orders or --refresh-readers");
}
const ordersOnly = refreshOrders || refreshReaders;
const upgrades = refreshReaders ? [] : refreshOrders ? ["FlowExecutor"] : ["FlowExecutor", "AccountFactory", "PriceProtection", "TermbookCore"];
const shared = ordersOnly ? ["SpotOrderTracker", "UseCaseReader", "UseCasePolicy", "UseCaseRecovery"] : ["ReadProgram", "UseCaseReader", "UseCasePolicy", "UseCaseRecovery", "AtomicSpotRouter", "AtomicSpotModule", "AppHealthReaderFactory"];
const implementationArtifact = upgradeArtifactLoader(path.join(root, "contracts/evm/out"));
const canonical = (value) => JSON.stringify(value, (_, entry) => typeof entry === "bigint" ? entry.toString() : entry);
const equal = (actual, expected, label) => {
  if (canonical(actual).toLowerCase() !== canonical(expected).toLowerCase()) throw new Error(`Verification failed: ${label}`);
};
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

async function refreshPriceProtection() {
  const name = "PriceProtection", operation = "price-protection-update";
  const { deployment, report, persist, context } = await testnetRuntime(operation, simulate);
  const monad = await context(10143), m = deployment.addresses[10143];
  const candidate = implementationArtifact(name), build = viem.keccak256(candidate.bytecode.object);
  if (report.build && report.build !== build || report.sourceCommit && report.sourceCommit !== sourceCommit) throw new Error("Price protection build changed");
  report.baseline ??= deployment.proxies[10143][name];
  report.build = build; report.sourceCommit = sourceCommit;
  const baseline = report.baseline;
  validateUpgradeArtifact(baseline, candidate);
  equal(await monad.read("ProtocolGovernance", m.ProtocolGovernance, "governance"), deployment.deployer, "governance owner");
  equal(await monad.read("ProtocolGovernance", m.ProtocolGovernance, "timelock"), 0n, "testnet delay");
  equal(await monad.read("UpgradeController", m.UpgradeController, "owner"), m.ProtocolGovernance, "upgrade owner");
  equal(await monad.read("TestnetProxy", m[name], "proxyAdmin"), baseline.admin, "proxy administrator");
  equal(await monad.read("UpgradeController", m.UpgradeController, "contractIds", [m[name]]), baseline.contractId, "proxy identity");
  const current = await monad.read("TestnetProxy", m[name], "proxyImplementation");
  const pin = current.toLowerCase() === baseline.implementation.toLowerCase() ? baseline : report.proxy;
  if (!pin || pin.implementation.toLowerCase() !== current.toLowerCase()) throw new Error("Price protection baseline changed");
  equal(viem.keccak256(await monad.client.getCode({ address: current })), pin.implementationCodeHash, "live implementation");
  const state = async () => {
    const blockNumber = await monad.client.getBlockNumber();
    const read = (functionName, args = []) => monad.client.readContract({ address: m[name], abi: candidate.abi, functionName, args, blockNumber });
    const count = baseline.storageLayout.storage.reduce((max, field) => Math.max(max, Number(field.slot) + Math.ceil(Number(baseline.storageLayout.types[field.type].numberOfBytes) / 32)), 0);
    const slots = await Promise.all(Array.from({ length: count }, (_, index) => monad.client.getStorageAt({ address: m[name], slot: viem.toHex(index, { size: 32 }), blockNumber })));
    const rules = {};
    for (const installed of Object.values(deployment.configuration ?? {}).filter((entry) => entry.definition?.actions && entry.bundleId)) {
      for (const action of installed.definition.actions) for (const market of action.price?.markets ?? []) {
        const args = [installed.bundleId, viem.keccak256(viem.stringToHex(executionKey(action))), market];
        const id = await read("key", args);
        rules[id] = [await read("rule", args), await read("ruleHashes", [id]), await read("amountRules", [id])];
      }
    }
    return JSON.parse(canonical({ core: await read("core"), slots, rules }));
  };
  report.before ??= await state(); persist();
  equal(await state(), report.before, "preserved price bindings");
  if (!simulate && !report.completedAt) {
    const plan = JSON.parse(fs.readFileSync(operationFile(`${operation}-simulation`), "utf8"));
    if (!plan.completedAt || plan.build !== build || plan.sourceCommit !== sourceCommit) throw new Error("Run the current-build simulation first");
    equal(plan.baseline.implementationCodeHash, baseline.implementationCodeHash, "simulated baseline");
    const remaining = plan.transactions.filter((tx) => !report.transactions.some((item) => item.name === tx.name && item.status === "success"));
    const gasPrice = await monad.client.getGasPrice();
    const budget = remaining.reduce((sum, tx) => sum + BigInt(tx.gasLimit), 0n) * (gasPrice > 100_000_000_000n ? gasPrice : 100_000_000_000n) * 11n / 10n;
    if (await monad.client.getBalance({ address: deployment.deployer }) < budget) throw new Error("Insufficient testnet gas");
  }
  const implementation = await monad.deploy(name, [viem.zeroAddress], `${name}CheckpointImplementation`);
  const codeHash = viem.keccak256(candidate.deployedBytecode.object);
  equal(viem.keccak256(await monad.client.getCode({ address: implementation })), codeHash, "candidate code");
  equal(await monad.read(name, implementation, "upgradeContractId"), baseline.contractId, "candidate identity");
  report.proxy = { ...baseline, implementation, implementationCodeHash: codeHash, storageLayout: candidate.storageLayout, abi: candidate.abi }; persist();
  await monad.govern("UpgradeController", m.UpgradeController, "upgrade", [m[name], implementation, codeHash, "0x"]);
  equal(await monad.read("TestnetProxy", m[name], "proxyImplementation"), implementation, "upgraded proxy");
  equal(await monad.read(name, m[name], "referenceVersion"), 1n, "reference format");
  equal(await state(), report.before, "preserved price bindings");
  report.completedAt ??= new Date().toISOString(); persist();
  if (!simulate) {
    deployment.proxies[10143][name] = report.proxy;
    m[`${name}Implementation`] = implementation;
    deployment.configuration.integrations.priceUpdate = { sourceCommit, completedAt: report.completedAt, storageUnchanged: true };
    if (deployment.configuration.integrations.sourceVerification) deployment.configuration.integrations.sourceVerification.contracts = deployment.configuration.integrations.sourceVerification.contracts.filter((item) => item.name !== name);
    writeJsonAtomic(path.join(root, "deployments/testnet.json"), deployment);
    const bindingsFile = path.join(root, "packages/bindings/src/generated/deployments.ts");
    fs.writeFileSync(bindingsFile, fs.readFileSync(bindingsFile, "utf8").replace(/export const deployments: DeploymentMap = \{[\s\S]*?\n\};/, `export const deployments: DeploymentMap = ${JSON.stringify(deployment.addresses, null, 2)};`));
    clearOperation(operation);
  }
  log(JSON.stringify({ simulated: simulate, verified: true, component: name, proxy: m[name], implementation,
    costMON: viem.formatEther(report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n)) }));
}

async function refreshSpotModule() {
  const operation = "spot-module-update";
  const { deployment, report, persist, context } = await testnetRuntime(operation, simulate);
  const monad = await context(10143), m = deployment.addresses[10143];
  const installed = deployment.configuration?.integrations;
  if (!installed?.verified || installed.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Shared integration setup required");
  const compiled = artifact("AtomicSpotModule");
  const build = viem.keccak256(compiled.bytecode.object);
  const normalize = (value) => {
    let result = value.slice(2);
    for (const references of Object.values(compiled.deployedBytecode.immutableReferences ?? {})) for (const { start, length } of references) {
      result = result.slice(0, start * 2) + "0".repeat(length * 2) + result.slice((start + length) * 2);
    }
    return `0x${result}`;
  };
  const resumed = Boolean(report.build);
  if (report.build && report.build !== build || report.sourceCommit && report.sourceCommit !== sourceCommit) throw new Error("Spot module build changed");
  report.build = build; report.sourceCommit = sourceCommit;
  report.previous ??= installed.contractPins?.AtomicSpotModule;
  if (!report.previous || report.previous.address.toLowerCase() !== m.AtomicSpotModule.toLowerCase()
    && report.addresses.AtomicSpotModule?.toLowerCase() !== m.AtomicSpotModule.toLowerCase()) throw new Error("Spot module baseline changed");
  equal(await monad.read("ProtocolGovernance", m.ProtocolGovernance, "governance"), deployment.deployer, "governance owner");
  const previousCode = await monad.client.getCode({ address: report.previous.address });
  equal(viem.keccak256(previousCode), report.previous.codeHash, "previous module code");
  const bindings = { governance: m.ProtocolGovernance, core: m.TermbookCore, router: m.AtomicSpotRouter, registry: m.IntegrationRegistry };
  for (const [method, expected] of Object.entries(bindings)) equal(await monad.read("AtomicSpotModule", report.previous.address, method), expected, `previous module.${method}`);
  if (!resumed && normalize(previousCode) === normalize(compiled.deployedBytecode.object)) {
    clearOperation(operation, simulate); log(JSON.stringify({ configured: true, component: "AtomicSpotModule", address: m.AtomicSpotModule })); return;
  }
  persist();
  if (!simulate) {
    const plan = JSON.parse(fs.readFileSync(operationFile(`${operation}-simulation`), "utf8"));
    if (!plan.completedAt || plan.build !== build || plan.sourceCommit !== sourceCommit) throw new Error("Run the current-build simulation first");
    equal(plan.previous, report.previous, "simulated module baseline");
    const gasPrice = await monad.client.getGasPrice();
    const gas = plan.transactions.filter((tx) => !report.transactions.some((entry) => entry.name === tx.name && entry.status === "success"))
      .reduce((sum, tx) => sum + BigInt(tx.gasLimit), 0n);
    const budget = gas * (gasPrice > 100_000_000_000n ? gasPrice : 100_000_000_000n) * 11n / 10n + 10_000_000_000_000_000n;
    if (await monad.client.getBalance({ address: deployment.deployer }) < budget) throw new Error("Insufficient testnet gas");
  }
  const address = await monad.deploy("AtomicSpotModule", Object.values(bindings));
  const code = await monad.client.getCode({ address });
  equal(normalize(code), normalize(compiled.deployedBytecode.object), "new module runtime");
  for (const [method, expected] of Object.entries(bindings)) equal(await monad.read("AtomicSpotModule", address, method), expected, `new module.${method}`);
  report.completedAt ??= new Date().toISOString(); persist();
  if (!simulate) {
    m.AtomicSpotModule = address;
    installed.addresses.AtomicSpotModule = address;
    installed.contractPins.AtomicSpotModule = { address, codeHash: viem.keccak256(code) };
    installed.moduleUpdate = { sourceCommit, completedAt: report.completedAt };
    if (installed.sourceVerification) installed.sourceVerification.contracts = installed.sourceVerification.contracts.filter((item) => item.name !== "AtomicSpotModule");
    writeJsonAtomic(path.join(root, "deployments/testnet.json"), deployment);
    const bindingsFile = path.join(root, "packages/bindings/src/generated/deployments.ts");
    fs.writeFileSync(bindingsFile, fs.readFileSync(bindingsFile, "utf8").replace(/export const deployments: DeploymentMap = \{[\s\S]*?\n\};/,
      `export const deployments: DeploymentMap = ${JSON.stringify(deployment.addresses, null, 2)};`));
    const envFile = path.join(root, ".env");
    fs.writeFileSync(envFile, fs.readFileSync(envFile, "utf8").replace(/^ATOMIC_SPOT_MODULE=.*\n?/m, "") + `ATOMIC_SPOT_MODULE=${address}\n`, { mode: 0o600 });
    clearOperation(operation);
  }
  log(JSON.stringify({ simulated: simulate, verified: true, component: "AtomicSpotModule", address,
    transaction: report.transactions.find((tx) => tx.name === "AtomicSpotModule").hash,
    costMON: viem.formatEther(report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n)) }));
}

async function main() {
  const operation = refreshReaders ? "shared-reader-update" : refreshOrders ? "shared-order-update" : "shared-integration-upgrade";
  const configuration = ordersOnly ? "order-integrations" : "integrations";
  if (!simulate && !refreshReaders && alreadyConfigured(configuration)) { clearOperation(operation); log(JSON.stringify({ configured: true, step: configuration })); return; }
  const { deployment, report, persist, context } = await testnetRuntime(operation, simulate);
  const monad = await context(10143);
  const m = deployment.addresses[10143];
  if (deployment.upgradeMode !== "testnet-administrator") throw new Error("Upgradeable deployment required");
  if (report.sourceCommit && report.sourceCommit !== sourceCommit && !report.completedAt) throw new Error("Upgrade build changed");
  report.sourceCommit ??= sourceCommit;
  report.baselines ??= Object.fromEntries(upgrades.map((name) => [name, deployment.proxies[10143][name]]));
  report.proxies ??= {};
  const builds = Object.fromEntries([...upgrades, ...shared].map((name) => [name, viem.keccak256(artifact(name).bytecode.object)]));
  const installed = deployment.configuration?.[configuration];
  if (refreshReaders && installed?.builds && canonical(installed.builds) === canonical(builds)) {
    for (const name of shared) {
      equal(installed.addresses[name], m[name], `${name} installed address`);
      equal(viem.keccak256(await monad.client.getCode({ address: m[name] })), installed.contractPins[name].codeHash, `${name} installed runtime`);
    }
    clearOperation(operation, simulate); log(JSON.stringify({ configured: true, step: configuration })); return;
  }
  if (report.builds) equal(builds, report.builds, "compiled artifacts");
  report.builds = builds;
  persist();
  equal(await monad.read("ProtocolGovernance", m.ProtocolGovernance, "governance"), deployment.deployer, "governance owner");
  equal(await monad.read("ProtocolGovernance", m.ProtocolGovernance, "timelock"), 0n, "testnet delay");
  equal(await monad.read("UpgradeController", m.UpgradeController, "owner"), m.ProtocolGovernance, "upgrade owner");
  equal(await monad.read("TermbookCore", m.TermbookCore, "executionManager"), m.FlowExecutor, "execution proxy");
  if (!refreshReaders) equal(await monad.read("HouseVault", m.HouseVault, "activeCreditCount"), 0n, "settled loans");
  for (const name of upgrades) {
    const baseline = report.baselines[name], candidate = implementationArtifact(name);
    validateUpgradeArtifact(baseline, candidate);
    const current = await monad.read("TestnetProxy", m[name], "proxyImplementation");
    const pin = report.proxies[name] ?? baseline;
    if (![baseline.implementation, pin.implementation].some((address) => address.toLowerCase() === current.toLowerCase())) throw new Error(`Unexpected implementation: ${name}`);
    const expectedHash = current.toLowerCase() === baseline.implementation.toLowerCase() ? baseline.implementationCodeHash : pin.implementationCodeHash;
    equal(viem.keccak256(await monad.client.getCode({ address: current })), expectedHash, `${name} live code`);
    equal(await monad.read("UpgradeController", m.UpgradeController, "contractIds", [m[name]]), baseline.contractId, `${name} identity`);
    equal(await monad.read("TestnetProxy", m[name], "proxyAdmin"), baseline.admin, `${name} administrator`);
  }

  let inventory;
  async function state() {
    const blockNumber = await monad.client.getBlockNumber();
    const read = (name, address, functionName, args = []) => monad.client.readContract({ address, abi: artifact(name).abi, functionName, args, blockNumber });
    inventory ??= (await loadCredits(deployment, monad)).observations.map((entry) => entry.creditId).sort();
    const ids = inventory;
    equal(await read("TermbookCore", m.TermbookCore, "acceptedCredits"), BigInt(ids.length), "complete credit inventory");
    const result = { storage: {}, credits: {}, house: {} };
    for (const name of upgrades) {
      const baseline = report.baselines[name];
      const count = baseline.storageLayout.storage.reduce((max, slot) => Math.max(max, Number(slot.slot)
        + Math.ceil(Number(baseline.storageLayout.types[slot.type].numberOfBytes) / 32)), 0);
      result.storage[name] = [];
      for (let from = 0; from < count; from += 16) {
        const slots = Array.from({ length: Math.min(16, count - from) }, (_, index) => from + index);
        result.storage[name].push(...await Promise.all(slots.map((slot) => monad.client.getStorageAt({ address: m[name], slot: viem.toHex(slot, { size: 32 }), blockNumber }))));
      }
    }
    result.credits = Object.fromEntries(await Promise.all(ids.map(async (id) => {
      const [credit, account] = await Promise.all([
        read("TermbookCore", m.TermbookCore, "creditDetails", [id]), read("AccountFactory", m.AccountFactory, "accountOf", [id]),
      ]);
      if (!refreshReaders && (![6, 7, 10].includes(credit.facility) || credit.debt !== 0n || !credit.collateralReturned)) throw new Error("Existing credit must finish before this upgrade");
      return [id, { credit, account, released: await read("CreditAccount", credit.account, "released") }];
    })));
    const methods = ["asset", "totalAssets", "totalShares", "activeCreditCount", "freeCash", "committedCash", "drawnPrincipal", "accruedReceivables", "pendingSettlement", "impairment", "bondLiabilities", "bondCash", "lateRecoveryCash", "unresolvedCreditImpairment"];
    result.house = Object.fromEntries(await Promise.all(methods.map(async (method) => [method, await read("HouseVault", m.HouseVault, method)])));
    result.house.lpShares = await read("HouseVault", m.HouseVault, "shares", [deployment.deployer]);
    return JSON.parse(canonical(result));
  }
  if (!report.before) { report.before = await state(); persist(); }
  equal(await state(), report.before, "pre-upgrade state");
  if (!simulate && !report.completedAt) {
    const plan = JSON.parse(fs.readFileSync(operationFile(`${operation}-simulation`), "utf8"));
    if (!plan.completedAt || plan.sourceCommit !== sourceCommit) throw new Error("Run the current-build simulation first");
    equal(plan.builds, builds, "simulated build");
    for (const name of upgrades) equal(plan.baselines[name].implementationCodeHash, report.baselines[name].implementationCodeHash, "simulated baseline");
    const gasPrice = await monad.client.getGasPrice();
    const remainingGas = plan.transactions.filter((tx) => !report.transactions.some((entry) => entry.name === tx.name && entry.status === "success"))
      .reduce((sum, tx) => sum + BigInt(tx.gasLimit), 0n);
    const budget = remainingGas * (gasPrice > 100_000_000_000n ? gasPrice : 100_000_000_000n) * 11n / 10n + 10_000_000_000_000_000n;
    const balance = await monad.client.getBalance({ address: deployment.deployer });
    if (balance < budget) {
      log(JSON.stringify({ status: "funding-required", wallet: deployment.deployer, balanceMON: viem.formatEther(balance), budgetMON: viem.formatEther(budget), missingMON: viem.formatEther(budget - balance) }));
      process.exitCode = 2; return;
    }
  }
  for (const name of upgrades) {
    const candidate = implementationArtifact(name), baseline = report.baselines[name];
    const args = (candidate.abi.find((entry) => entry.type === "constructor")?.inputs ?? []).map((input) => {
      if (input.type === "address") return viem.zeroAddress;
      throw new Error(`Unsupported implementation constructor: ${name}`);
    });
    const implementation = await monad.deploy(name, args, `${name}SharedImplementation`);
    const implementationCodeHash = viem.keccak256(candidate.deployedBytecode.object);
    equal(viem.keccak256(await monad.client.getCode({ address: implementation })), implementationCodeHash, `${name} candidate code`);
    equal(await monad.read(name, implementation, "upgradeContractId"), baseline.contractId, `${name} candidate identity`);
    report.proxies[name] = { ...baseline, implementation, implementationCodeHash, storageLayout: candidate.storageLayout, abi: candidate.abi };
    persist();
    await monad.govern("UpgradeController", m.UpgradeController, "upgrade", [m[name], implementation, implementationCodeHash, "0x"]);
    equal(await monad.read("TestnetProxy", m[name], "proxyImplementation"), implementation, `${name} upgraded proxy`);
    log(JSON.stringify({ simulated: simulate, upgraded: name, proxy: m[name], implementation }));
  }
  const programs = ordersOnly ? m.ReadProgram : await monad.deploy("ReadProgram", [m.ProtocolGovernance]);
  if (ordersOnly) await monad.deploy("SpotOrderTracker", [m.ProtocolGovernance, m.TermbookCore, m.IntegrationRegistry, programs]);
  const reader = await monad.deploy("UseCaseReader", [m.ProtocolGovernance, m.TermbookCore, m.IntegrationRegistry, programs]);
  await monad.deploy("UseCasePolicy", [m.ProtocolGovernance, m.TermbookCore, reader]);
  await monad.deploy("UseCaseRecovery", [m.ProtocolGovernance, m.TermbookCore, reader]);
  const router = ordersOnly ? m.AtomicSpotRouter : await monad.deploy("AtomicSpotRouter", [m.ProtocolGovernance, m.TermbookCore, m.IntegrationRegistry]);
  if (!ordersOnly) {
    await monad.deploy("AtomicSpotModule", [m.ProtocolGovernance, m.TermbookCore, router, m.IntegrationRegistry]);
    await monad.deploy("AppHealthReaderFactory", [m.TermbookCore, m.CollateralHealthReader]);
  }
  for (const name of shared) {
    const address = report.addresses[name];
    const compiled = artifact(name).deployedBytecode;
    const normalize = (code) => {
      let result = code.slice(2);
      for (const references of Object.values(compiled.immutableReferences ?? {})) {
        for (const { start, length } of references) result = result.slice(0, start * 2) + "0".repeat(length * 2) + result.slice((start + length) * 2);
      }
      return `0x${result}`;
    };
    equal(normalize(await monad.client.getCode({ address })), normalize(compiled.object), `${name} compiled runtime`);
    const bindings = name === "ReadProgram" ? { governance: m.ProtocolGovernance }
      : name === "AppHealthReaderFactory" ? { core: m.TermbookCore, collateralReader: m.CollateralHealthReader }
        : { governance: m.ProtocolGovernance, core: m.TermbookCore,
          ...(["UseCaseReader", "SpotOrderTracker", "AtomicSpotRouter", "AtomicSpotModule"].includes(name) ? { registry: m.IntegrationRegistry } : {}),
          ...(["UseCaseReader", "SpotOrderTracker"].includes(name) ? { programs } : {}),
          ...(["UseCasePolicy", "UseCaseRecovery"].includes(name) ? { reader } : {}),
          ...(name === "AtomicSpotModule" ? { router } : {}) };
    for (const [method, expected] of Object.entries(bindings)) equal(await monad.read(name, address, method), expected, `${name}.${method}`);
  }
  report.after = await state();
  equal(report.after, report.before, "preserved storage, credits and House");
  report.verified = true;
  report.completedAt ??= new Date().toISOString();
  persist();
  if (!simulate) {
    for (const name of upgrades) {
      deployment.proxies[10143][name] = report.proxies[name];
      m[`${name}Implementation`] = report.proxies[name].implementation;
    }
    for (const name of shared) m[name] = report.addresses[name];
    deployment.sharedIntegrations = { sourceCommit: report.sourceCommit, completedAt: report.completedAt, configuration };
    writeJsonAtomic(path.join(root, "deployments/testnet.json"), deployment);
    const bindingsFile = path.join(root, "packages/bindings/src/generated/deployments.ts");
    const bindings = fs.readFileSync(bindingsFile, "utf8");
    fs.writeFileSync(bindingsFile, bindings.replace(/export const deployments: DeploymentMap = \{[\s\S]*?\n\};/,
      `export const deployments: DeploymentMap = ${JSON.stringify(deployment.addresses, null, 2)};`));
    const integration = { network: "testnet", chainId: 10143,
      sourceCommit: report.sourceCommit, completedAt: report.completedAt, verified: true, core: m.TermbookCore, builds,
      upgrades: Object.fromEntries(upgrades.map((name) => [name, { proxy: m[name], previousImplementation: report.baselines[name].implementation,
        implementation: report.proxies[name].implementation, codeHash: report.proxies[name].implementationCodeHash }])),
      addresses: Object.fromEntries(shared.map((name) => [name, report.addresses[name]])),
      preserved: { credits: Object.keys(report.after.credits).length, house: report.after.house, storageUnchanged: true,
        storage: Object.fromEntries(Object.entries(report.before.storage).map(([name, slots]) => [name, { slots: slots.length, hash: viem.keccak256(viem.toHex(canonical(slots))) }])),
        creditHashes: Object.fromEntries(Object.entries(report.before.credits).map(([id, credit]) => [id, viem.keccak256(viem.toHex(canonical(credit)))])) },
      transactions: report.transactions.map(({ rawTransaction: _raw, ...tx }) => tx) };
    const envFile = path.join(root, ".env");
    const variables = { SHARED_READ_PROGRAM: programs, SHARED_USE_CASE_READER: reader, SHARED_USE_CASE_POLICY: report.addresses.UseCasePolicy,
      SHARED_USE_CASE_RECOVERY: report.addresses.UseCaseRecovery, ATOMIC_SPOT_ROUTER: router, ATOMIC_SPOT_MODULE: ordersOnly ? m.AtomicSpotModule : report.addresses.AtomicSpotModule,
      ...(ordersOnly ? { SHARED_SPOT_ORDER_TRACKER: report.addresses.SpotOrderTracker } : {}) };
    let env = fs.readFileSync(envFile, "utf8");
    for (const [key, value] of Object.entries(variables)) env = env.replace(new RegExp(`^${key}=.*\\n?`, "m"), "") + `${key}=${value}\n`;
    fs.writeFileSync(envFile, env, { mode: 0o600 });
    writeConfiguration(configuration, integration);
  }
  const cost = report.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n);
  log(JSON.stringify({ simulated: simulate, verified: true, transactions: report.transactions.length, costMON: viem.formatEther(cost), addresses: Object.fromEntries(shared.map((name) => [name, report.addresses[name]])) }));
  if (!simulate) clearOperation(operation, false);
}

const lockFile = operationFile(refreshPrices ? "price-protection-update" : refreshSpot ? "spot-module-update" : refreshReaders ? "shared-reader-update" : refreshOrders ? "shared-order-update" : "shared-integration-upgrade").replace(/\.json$/, ".lock");
let lock;
try {
  if (!simulate) {
    for (const file of fs.readdirSync(path.dirname(lockFile)).filter((file) => file.endsWith(".lock"))) {
      const owner = Number(fs.readFileSync(path.join(path.dirname(lockFile), file), "utf8"));
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("Invalid transaction runner lock");
      try { process.kill(owner, 0); throw new Error("Another transaction runner is active"); }
      catch (cause) { if (cause.code !== "ESRCH") throw cause; }
      if (file === path.basename(lockFile)) fs.unlinkSync(lockFile);
    }
    lock = fs.openSync(lockFile, "wx", 0o600); fs.writeFileSync(lock, String(process.pid));
  }
  if (refreshPrices) await refreshPriceProtection(); else if (refreshSpot) await refreshSpotModule(); else await main();
} catch (cause) {
  error(cause instanceof Error ? cause.message.split("\n")[0] : "Shared integration upgrade failed"); process.exitCode = 1;
} finally {
  if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockFile); }
}
