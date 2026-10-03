import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { log, error } from "node:console";
import { canonicalJson, apiAuthorizationMessage } from "../packages/schema/dist/index.js";
import { root, viem, artifact, testnetRuntime } from "./testnet-runtime.mjs";

const mode = process.argv[2];
if (!["--begin", "--advance", "--observe"].includes(mode) || process.argv.length !== 3) throw new Error("Use --begin, --advance, or --observe");
const api = "http://127.0.0.1:3002";
const erc20 = viem.parseAbi(["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"]);
const wethAbi = viem.parseAbi(["function deposit() payable"]);
const encode = (name, method, args) => viem.encodeFunctionData({ abi: artifact(name).abi, functionName: method, args });
const amounts = { collateral: 200_000_000_000_000n, limit: 2_000_000n, draw: 1_000_000n, bond: 20_000n };
const numericQuote = ["sourceChain", "collateralAmount", "limit", "setupDeadline", "maturity", "gracePeriod", "reservationBond", "nonce", "expiry", "aprBps", "originationFee", "commitmentFeeBps"];
const quoteValue = (quote) => Object.fromEntries(Object.entries(quote).map(([key, value]) => [key, numericQuote.includes(key) ? BigInt(value) : value]));

async function main() {
  const runtime = await testnetRuntime("live-e2e", false);
  const { deployment, report, persist, account } = runtime;
  const monad = await runtime.context(10143);
  const source = await runtime.context(11155111);
  const m = deployment.addresses[10143];
  const s = deployment.addresses[11155111];
  const usdc = deployment.tokens[10143].USDC;
  const weth = deployment.tokens[11155111].WETH;
  const appSetup = JSON.parse(fs.readFileSync(path.join(root, "deployments/testnet-app.json"), "utf8"));
  const app = appSetup.addresses.ReferenceAssetApp;
  const coreRead = (name, args = []) => monad.read("TermbookCore", m.TermbookCore, name, args);
  const now = (await monad.client.getBlock()).timestamp;
  if (!m.AccountHealthSource || (await coreRead("healthSource")).toLowerCase() !== m.AccountHealthSource.toLowerCase()) throw new Error("Authenticated health source is required");
  if (!await monad.read("IntegrationRegistry", m.IntegrationRegistry, "isActive", [appSetup.bundleId])) throw new Error("Test application is inactive");

  async function post(route, body) {
    const request = { method: "POST", path: route, bodyHash: viem.hashMessage(canonicalJson(body)) };
    const response = await globalThis.fetch(`${api}/auth/nonce`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: account.address, ...request }) });
    if (!response.ok) throw new Error(`API nonce failed: ${response.status}`);
    const challenge = await response.json();
    if (challenge.domain !== "api.termbook.testnet" || challenge.wallet !== account.address.toLowerCase()
      || challenge.message !== apiAuthorizationMessage(challenge.domain, account.address, challenge.nonce, challenge.expiresAt, request)
      || challenge.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("API authentication challenge mismatch");
    const signature = await account.signMessage({ message: challenge.message });
    const result = await globalThis.fetch(`${api}${route}`, { method: "POST", headers: { "content-type": "application/json",
      "x-termbook-wallet": account.address, "x-termbook-nonce": challenge.nonce, "x-termbook-signature": signature }, body: JSON.stringify(body) });
    if (!result.ok) {
      const reason = await result.json().catch(() => ({}));
      throw new Error(`API ${route} failed: ${result.status} ${typeof reason.error === "string" ? reason.error : "request rejected"}`);
    }
    return result.json();
  }

  if (mode === "--begin") {
    if (!(await globalThis.fetch(`${api}/ready`)).ok) throw new Error("Local services are not ready");
    await post("/houses", { house: account.address, vault: m.HouseVault, asset: usdc, manager: account.address });
    report.startedAt ??= new Date().toISOString();
    report.cases ??= {};
    persist();
    const policyHash = await monad.read("ReservationManager", m.ReservationManager, "policyHashes", [account.address, 1n]);
    for (const kind of ["repayment", "default"]) {
      let test = report.cases[kind];
      if (!test) {
        const nonce = BigInt(Date.now());
        const intentId = viem.keccak256(viem.stringToHex(`Termbook live E2E:${kind}:${report.startedAt}`));
        const creditId = viem.keccak256(viem.encodeAbiParameters(viem.parseAbiParameters("bytes32,address,address,uint256"),
          [intentId, account.address, account.address, nonce]));
        const lockId = viem.keccak256(viem.encodeAbiParameters(viem.parseAbiParameters("bytes32,string"), [creditId, "source-lock"]));
        const setupDeadline = now + 1800n;
        const quote = { borrower: account.address, owner: account.address, intentId, house: account.address,
          vault: m.HouseVault, sourceChain: 11155111n, collateralVault: s.CollateralVault,
          collateralAsset: weth, collateralAmount: amounts.collateral, returnRecipient: account.address,
          settlementAsset: usdc, limit: amounts.limit, bundleId: appSetup.bundleId,
          setupDeadline, maturity: kind === "default" ? setupDeadline + 120n : setupDeadline + 43_200n,
          gracePeriod: 60n, reservationBond: amounts.bond, nonce, expiry: setupDeadline,
          termsHash: viem.keccak256(viem.stringToHex(`Termbook reference app ${kind} live test`)),
          revolving: false, aprBps: 0n, originationFee: 0n, commitmentFeeBps: 0n,
          reservationPolicyHash: policyHash, bondPayer: account.address, bondRefundRecipient: account.address, signature: "0x" };
        const digest = await coreRead("quoteDigestFull", [quote]);
        quote.signature = await account.signMessage({ message: { raw: digest } });
        test = report.cases[kind] = { kind, creditId, lockId, quote: JSON.parse(canonicalJson(quote)), state: "prepared" };
        persist();
      }
      const quote = quoteValue(test.quote);
      await monad.send(`${kind}:approve-bond`, viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [m.HouseVault, amounts.bond] }), usdc);
      await monad.call("TermbookCore", m.TermbookCore, "acceptQuote", [quote], `${kind}:accept`);
      await post("/credits", { creditId: test.creditId, borrower: account.address, house: account.address });
      await monad.call("TermbookCore", m.TermbookCore, "bindRemoteCollateral", [test.creditId, test.lockId], `${kind}:bind-lock`);
      await monad.call("AccountFactory", m.AccountFactory, "create", [test.creditId, account.address, m.TermbookCore], `${kind}:create-account`);
      test.account = await monad.read("AccountFactory", m.AccountFactory, "accountOf", [test.creditId]);
      await monad.call("TermbookCore", m.TermbookCore, "bindAccount", [test.creditId, test.account], `${kind}:bind-account`);
      test.lockRevision ??= String(await coreRead("creditRevision", [test.creditId]));
      persist();
      await source.send(`${kind}:wrap-ETH`, viem.encodeFunctionData({ abi: wethAbi, functionName: "deposit" }), weth, amounts.collateral);
      await source.send(`${kind}:approve-WETH`, viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [s.CollateralVault, amounts.collateral] }), weth);
      const tx = await source.call("CollateralVault", s.CollateralVault, "lockRemoteWithDeadline", [test.lockId, test.creditId,
        account.address, account.address, amounts.collateral, account.address, quote.setupDeadline, BigInt(test.lockRevision)], `${kind}:lock-WETH`);
      test.lockTx = tx.hash;
      await post("/collateral", { lockId: test.lockId, creditId: test.creditId, owner: account.address, amount: String(amounts.collateral) });
      test.state = "awaiting_collateral_proof";
      persist();
    }
  }

  if (!report.cases) throw new Error("Run --begin first");
  if (mode === "--advance") {
    for (const test of Object.values(report.cases)) {
      let credit = await coreRead("creditDetails", [test.creditId]);
      if (credit.facility === 2) {
        const commitment = await source.read("CollateralVault", s.CollateralVault, "lockCommitments", [test.lockId]);
        const key = await source.read("WormholeEthereumPublisher", s.WormholeEthereumPublisher, "snapshotKey", [1, commitment, 0n]);
        if (!await source.read("WormholeEthereumPublisher", s.WormholeEthereumPublisher, "published", [key])) {
          const wormhole = await source.read("WormholeEthereumPublisher", s.WormholeEthereumPublisher, "wormhole");
          const fee = await source.client.readContract({ address: wormhole,
            abi: viem.parseAbi(["function messageFee() view returns(uint256)"]), functionName: "messageFee" });
          await source.send(`${test.kind}:publish-lock`, encode("WormholeEthereumPublisher", "publishLock", [test.lockId]), s.WormholeEthereumPublisher, fee);
        }
      }
      if (credit.facility === 4 && !test.drawVerified) {
        test.action ??= { capability: viem.keccak256(viem.stringToHex("deposit")),
          market: viem.keccak256(viem.stringToHex("Termbook reference USDC position")),
          calls: [{ target: app, spendToken: usdc, spendAmount: String(amounts.draw),
            data: encode("ReferenceAssetApp", "deposit", [amounts.draw]) }], requiredInput: String(amounts.draw), exposureLimit: String(amounts.draw) };
        if (!test.execution) {
          const authorization = { drawAmount: amounts.draw, maxDraw: amounts.draw, nonce: 1n, deadline: now + 600n,
            revision: credit.revision, signer: account.address, signature: "0x",
            price: { roundId: 0n, referencePrice: 0n, updatedAt: 0n, authorizedAt: 0n, bound: 0n, slippageBps: 0, isMax: false } };
          const digest = await coreRead("executionDigest", [test.creditId, test.action, authorization]);
          authorization.signature = await account.signMessage({ message: { raw: digest } });
          test.execution = JSON.parse(canonicalJson(authorization));
          persist();
        }
        await monad.call("TermbookCore", m.TermbookCore, "executePlan", [test.creditId, test.action, test.execution], `${test.kind}:borrow-and-deposit`);
        const [health, position, cash] = await Promise.all([
          coreRead("previewHealth", [test.creditId]), monad.read("ReferenceAssetApp", app, "positions", [test.account]),
          monad.client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [test.account] }),
        ]);
        if (health.debt !== amounts.draw || health.appValue !== amounts.draw || position !== amounts.draw
          || cash !== 0n || health.sourceValue >= health.debt || health.healthBps < 12_500n) throw new Error("Live draw or valuation mismatch");
        test.drawVerified = { at: new Date().toISOString(), ...JSON.parse(canonicalJson(health)), appPosition: String(position), accountCash: String(cash) };
        test.state = test.kind === "default" ? "awaiting_default" : "repayment_pending";
        persist();
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      if (test.kind === "repayment" && test.drawVerified && credit.facility === 4) {
        await monad.call("TermbookCore", m.TermbookCore, "exitApp", [test.creditId, viem.encodeAbiParameters(viem.parseAbiParameters("uint256"), [amounts.draw])], "repayment:exit-app");
        await monad.call("TermbookCore", m.TermbookCore, "repayFromAccount", [test.creditId, amounts.draw], "repayment:repay");
        await monad.call("TermbookCore", m.TermbookCore, "startClosing", [test.creditId], "repayment:start-closing");
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      const returnAllowed = test.drawVerified && credit.debt === 0n && !credit.collateralReturned
        && (credit.facility === 5 || [8, 9].includes(credit.facility));
      if (returnAllowed && !test.returnTx) {
        const wormhole = await coreRead("ethereumWormholeCore");
        const fee = await monad.client.readContract({ address: wormhole,
          abi: viem.parseAbi(["function messageFee() view returns(uint256)"]), functionName: "messageFee" });
        const tx = await monad.send(`${test.kind}:authorize-return`, encode("TermbookCore", "authorizeReturn", [test.creditId, test.lockId, credit.collateralAmount]), m.TermbookCore, fee);
        test.returnTx = tx.hash;
        persist();
      }
      if (test.returnTx && !credit.collateralReturned) {
        await post("/collateral/actions", { creditId: test.creditId, kind: "release", authorizationTxHash: test.returnTx });
        test.state = "awaiting_collateral_return";
        persist();
      }
      credit = await coreRead("creditDetails", [test.creditId]);
      if (credit.collateralReturned && credit.facility === 5) {
        await monad.call("TermbookCore", m.TermbookCore, "finishClose", [test.creditId], `${test.kind}:finish-close`);
      }
      if (test.kind === "default" && test.drawVerified && credit.debt === 0n && credit.collateralReturned && [8, 9].includes(credit.facility)) {
        await monad.call("HouseVault", m.HouseVault, "finalizeRecovery", [test.creditId], "default:finalize-recovery");
        await monad.call("TermbookCore", m.TermbookCore, "finishLiquidation", [test.creditId], "default:finish-liquidation");
        await monad.call("TermbookCore", m.TermbookCore, "releaseLiquidatedAccount", [test.creditId], "default:release-account");
      }
    }
  }

  const observations = [];
  for (const test of Object.values(report.cases)) {
    const credit = await coreRead("creditDetails", [test.creditId]);
    const sourceLock = await source.read("CollateralVault", s.CollateralVault, "locks", [test.lockId]);
    const position = await monad.read("ReferenceAssetApp", app, "positions", [test.account]);
    const completed = [6, 10].includes(credit.facility) && credit.debt === 0n && credit.collateralReturned && position === 0n && sourceLock[2] === 0n;
    if (completed) test.state = "completed";
    observations.push({ kind: test.kind, creditId: test.creditId, lockId: test.lockId, account: test.account,
      state: test.state, facility: credit.facility, payment: credit.payment, debt: String(credit.debt),
      collateralReturned: credit.collateralReturned, sourceLockedAmount: String(sourceLock[2]), appPosition: String(position),
      maturity: String(credit.maturity), grace: String(credit.grace), drawVerified: test.drawVerified, completed });
  }
  report.observedAt = new Date().toISOString();
  report.observations = observations;
  persist();
  fs.writeFileSync(path.join(root, "deployments/testnet-e2e.json"), JSON.stringify({ network: "testnet", observedAt: report.observedAt,
    scope: "Real Sepolia WETH custody, Wormhole proofs, Monad USDC borrowing and reference app recovery",
    excluded: "Aurora conversions and real perps venue behavior", core: m.TermbookCore, app, observations,
    transactions: report.transactions.map((tx) => Object.fromEntries(Object.entries(tx).filter(([key]) => key !== "rawTransaction"))) }, null, 2) + "\n");
  log(JSON.stringify({ observedAt: report.observedAt, cases: observations }));
}
main().catch((cause) => { error(cause instanceof Error ? cause.message.split("\n")[0] : "Live testnet E2E failed"); process.exitCode = 1; });
