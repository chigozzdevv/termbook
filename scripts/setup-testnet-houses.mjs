import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { root, viem, testnetRuntime, artifact } from "./testnet-runtime.mjs";
import { writeConfiguration, clearOperation, operationFile } from "./testnet-state.mjs";
import { apiAuthorizationMessage, canonicalJson } from "../packages/schema/dist/index.js";

const require = createRequire(path.join(root, "packages/sdk/package.json"));
const { privateKeyToAccount } = require("viem/accounts");
const simulate = process.argv.includes("--simulate");
if (process.argv.length !== 3 || simulate === process.argv.includes("--broadcast")) {
  throw new Error("Use --simulate or --broadcast");
}
const defaults = [12_500, 12_000, 11_750, 11_500, 11_000];
const profiles = [
  ...Array.from({ length: 3 }, () => ({ liquidity: 12_000, apr: 600, limit: 500, term: 7 * 86400, bands: defaults })),
  ...Array.from({ length: 2 }, () => ({ liquidity: 6_000, apr: 400, limit: 200, term: 3 * 86400, bands: defaults })),
  ...Array.from({ length: 2 }, () => ({ liquidity: 8_000, apr: 800, limit: 1_000, term: 14 * 86400,
    bands: [14_000, 13_000, 12_500, 12_000, 11_500] })),
  ...Array.from({ length: 2 }, () => ({ liquidity: 4_500, apr: 500, limit: 250, term: 7 * 86400,
    bands: [15_000, 14_000, 13_500, 12_500, 12_000] })),
  { liquidity: 2_000, apr: 600, limit: 5, term: 900, bands: defaults },
];
const units = (value) => BigInt(value) * 1_000_000n;
const erc20 = viem.parseAbi(["function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)"]);

async function registerApi(account, house) {
  const api = process.env["TERMBOOK_PUBLIC_API_BASE"] ?? "http://127.0.0.1:3002";
  const url = new URL(api);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("House registration API must be local");
  const body = { house: house.manager, manager: house.manager, vault: house.vault, asset: house.asset };
  const request = { method: "POST", path: "/houses", bodyHash: viem.hashMessage(canonicalJson(body)) };
  const response = await globalThis.fetch(`${api}/auth/nonce`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: account.address, ...request }) });
  if (!response.ok) throw new Error("House registration challenge unavailable");
  const challenge = await response.json();
  if (challenge.domain !== "api.termbook.testnet" || challenge.wallet !== account.address.toLowerCase()
    || challenge.expiresAt <= Math.floor(Date.now() / 1000)
    || challenge.message !== apiAuthorizationMessage(challenge.domain, account.address, challenge.nonce, challenge.expiresAt, request)) {
    throw new Error("House registration challenge mismatch");
  }
  const signature = await account.signMessage({ message: challenge.message });
  const result = await globalThis.fetch(`${api}/houses`, { method: "POST", headers: { "content-type": "application/json",
    "x-termbook-wallet": account.address, "x-termbook-nonce": challenge.nonce, "x-termbook-signature": signature }, body: JSON.stringify(body) });
  if (!result.ok) throw new Error(`House registration failed: ${result.status}`);
  const registered = await result.json();
  if (registered.vault?.toLowerCase() !== house.vault.toLowerCase()) throw new Error("House API registration mismatch");
}

async function main() {
  const runtime = await testnetRuntime("houses", simulate);
  const { deployment, report, persist } = runtime;
  const network = await runtime.context(10143), m = deployment.addresses[10143], asset = deployment.tokens[10143].USDC;
  const implementation = deployment.proxies[10143].HouseVault;
  if (viem.keccak256(await network.client.getCode({ address: implementation.implementation })) !== implementation.implementationCodeHash
    || (await network.read("UpgradeController", m.UpgradeController, "owner")).toLowerCase() !== m.ProtocolGovernance.toLowerCase()
    || (await network.read("HouseVault", m.HouseVault, "asset")).toLowerCase() !== asset.toLowerCase()
    || (await network.read("TermbookCore", m.TermbookCore, "houseRegistry")).toLowerCase() !== m.HouseRegistry.toLowerCase()) {
    throw new Error("Existing deployment binding changed");
  }
  const wallets = profiles.map((profile, index) => {
    const id = `house-${String(index + 1).padStart(2, "0")}`;
    const wallet = JSON.parse(fs.readFileSync(path.join(root, `.testnet/houses/${id}.json`), "utf8"));
    const signer = privateKeyToAccount(wallet.privateKey);
    if (signer.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("House manager key mismatch");
    return { id, signer, ...profile };
  });
  if (new Set(wallets.map((house) => house.signer.address.toLowerCase())).size !== 10
    || profiles.reduce((total, house) => total + house.liquidity, 0) !== 75_000) throw new Error("House allocation mismatch");
  const planHash = viem.keccak256(viem.toHex(JSON.stringify({ core: m.TermbookCore, implementation: implementation.implementation,
    asset, profiles: wallets.map(({ signer, ...house }) => ({ ...house, manager: signer.address })) })));
  const existing = deployment.configuration.houses;
  if (!simulate && existing?.completedAt) {
    if (existing.planHash !== planHash || existing.houses?.length !== 10) throw new Error("Existing House plan mismatch");
    for (const house of existing.houses) {
      if (!await network.read("HouseRegistry", m.HouseRegistry, "isActiveHouse", [house.manager, house.vault])
        || await network.read("HouseRegistry", m.HouseRegistry, "activePolicyVersion", [house.manager]) !== 1n) {
        throw new Error("Existing House admission changed");
      }
    }
    log(JSON.stringify({ configured: true, houses: 10 })); return;
  }
  if (report.planHash && report.planHash !== planHash) throw new Error("House plan changed");
  report.planHash = planHash; report.houses ??= []; persist();
  if (!simulate) {
    const plan = JSON.parse(fs.readFileSync(operationFile("houses-simulation"), "utf8"));
    if (!plan.completedAt || plan.planHash !== planHash || Date.now() - Date.parse(plan.completedAt) > 3_600_000) {
      throw new Error("Matching recent House simulation required");
    }
    const remaining = plan.transactions.filter((tx) => !report.transactions.some((sent) => sent.name === tx.name && sent.status === "success"));
    const gasPrice = await network.client.getGasPrice();
    const budget = remaining.reduce((total, tx) => total + BigInt(tx.gasLimit), 0n)
      * (gasPrice < 100_000_000_000n ? 100_000_000_000n : gasPrice) * 11n / 10n + viem.parseEther("2.5");
    if (await network.client.getBalance({ address: deployment.deployer }) < budget) throw new Error(`House setup requires ${viem.formatEther(budget)} test MON`);
  }
  const outstanding = wallets.filter((house) => !report.transactions.some((tx) => tx.name === `${house.id}:deposit` && tx.status === "success"))
    .reduce((total, house) => total + units(house.liquidity), 0n);
  if (await network.client.readContract({ address: asset, abi: erc20, functionName: "balanceOf", args: [deployment.deployer] }) < outstanding) {
    throw new Error("Insufficient USDC for the outstanding House deposits");
  }
  for (const house of wallets) {
    const manager = house.signer.address;
    await network.send(`${house.id}:manager-gas`, "0x", manager, viem.parseEther("0.25"));
    const initialization = viem.encodeFunctionData({ abi: artifact("HouseVault").abi, functionName: "initialize",
      args: [asset, m.TermbookCore, manager, m.InboxFactory, m.Guardian] });
    const vault = await network.deploy("TestnetProxy", [implementation.implementation, m.UpgradeController, initialization], `${house.id}:vault`);
    await network.govern("UpgradeController", m.UpgradeController, "register", [vault]);
    await network.govern("HouseRegistry", m.HouseRegistry, "register", [manager, vault, asset, manager]);
    const managed = await runtime.context(10143, simulate ? manager : house.signer);
    await managed.call("HouseRegistry", m.HouseRegistry, "setPolicy", [manager, 1n, units(house.limit), 900n, BigInt(house.term), BigInt(house.apr), 0n, 0n], `${house.id}:policy`);
    await managed.call("HouseRegistry", m.HouseRegistry, "setRiskPolicy", [manager, ...house.bands.map(BigInt)], `${house.id}:risk`);
    await network.govern("TermbookCore", m.TermbookCore, "configureReservationPolicy", [manager, 1n, {
      vault, maxSetupDuration: 7200, annualRateBps: 100, maxBorrowerCount: 1, maxHouseCount: 8,
      maxBorrowerLimit: units(house.limit), maxHouseLimit: units(house.limit * 8), readyFee: 0n,
      abandonFee: 5000n, expiryFee: 5000n, repeatPenalty: 1000n, maxSlippageBps: 100,
    }]);
    await network.send(`${house.id}:approve`, viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [vault, units(house.liquidity)] }), asset);
    await network.call("HouseVault", vault, "deposit", [deployment.deployer, units(house.liquidity)], `${house.id}:deposit`);
    const [registered, version, cash, shares, proxy, admin, id] = await Promise.all([
      network.read("HouseRegistry", m.HouseRegistry, "isActiveHouse", [manager, vault]),
      network.read("HouseRegistry", m.HouseRegistry, "activePolicyVersion", [manager]),
      network.read("HouseVault", vault, "freeCash"), network.read("HouseVault", vault, "shares", [deployment.deployer]),
      network.read("TestnetProxy", vault, "proxyImplementation"), network.read("TestnetProxy", vault, "proxyAdmin"),
      network.read("UpgradeController", m.UpgradeController, "contractIds", [vault]),
    ]);
    if (!registered || version !== 1n || cash !== units(house.liquidity) || shares !== units(house.liquidity)
      || proxy.toLowerCase() !== implementation.implementation.toLowerCase() || id !== implementation.contractId) {
      throw new Error(`House verification failed: ${house.id}`);
    }
    const config = { id: house.id, manager, vault, asset, initialLiquidity: String(cash), initialLp: deployment.deployer,
      policyVersion: 1, maxLimit: String(units(house.limit)), aprBps: house.apr, minTermSeconds: 900,
      maxTermSeconds: house.term, riskBandsBps: house.bands, implementation: proxy, admin };
    if (!simulate) await registerApi(runtime.account, config);
    report.houses = [...report.houses.filter((entry) => entry.id !== house.id), config]; persist();
    log(JSON.stringify({ simulated: simulate, house: house.id, vault, liquidityUSDC: house.liquidity }));
  }
  report.completedAt = new Date().toISOString(); persist();
  if (!simulate) { writeConfiguration("houses", report); clearOperation("houses"); }
  log(JSON.stringify({ simulated: simulate, houses: report.houses.length, liquidityUSDC: 75_000,
    transactionCostMON: viem.formatEther(report.transactions.reduce((total, tx) => total + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice), 0n)),
    managerFundingMON: "2.5" }));
}

main().catch((cause) => { error(cause.shortMessage ?? cause.message); process.exitCode = 1; });
