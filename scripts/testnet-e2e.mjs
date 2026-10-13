import { operationFile, operationLock, readConfiguration, clearOperation } from "./testnet-state.mjs";
import fs from "node:fs";
import process from "node:process";
import { log, error } from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson, apiAuthorizationMessage, selectCapability, executionKey } from "../packages/schema/dist/index.js";
import { viem, artifact, testnetRuntime, writeJsonAtomic } from "./testnet-runtime.mjs";

const mode = process.argv[2];
const fast = process.argv[3] === "--fast";
const clean = process.argv[4] === "--clean";
const base = process.argv[3] === "--base-kuru";
const orders = process.argv[3] === "--kuru-orders" || base;
const kuru = process.argv[3] === "--kuru" || orders;
const native = !base && (process.argv[3] === "--native" || kuru);
if (!["--begin", "--start", "--retry-default", "--advance", "--run", "--observe", "--close-unused"].includes(mode) || clean && !fast
  || process.argv.length !== (clean ? 5 : fast || native || base ? 4 : 3)) throw new Error("Use --begin, --start, --retry-default, --advance, --run, --observe or --close-unused with optional --base-kuru, --kuru-orders, --kuru, --native, or --fast and --clean");
const journalName = base ? "base-kuru-e2e" : orders ? "kuru-orders-e2e" : kuru ? "kuru-e2e" : native ? "native-e2e" : fast ? clean ? "fast-clean-e2e" : "fast-e2e" : "live-e2e";
const publicName = base ? "testnet-base-kuru-e2e" : orders ? "testnet-kuru-orders-e2e" : kuru ? "testnet-kuru-e2e" : native ? "testnet-native-e2e" : fast ? clean ? "testnet-fast-clean-e2e" : "testnet-fast-e2e" : "testnet-e2e";
const api = "http://127.0.0.1:3002";
const erc20 = viem.parseAbi(["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"]);
const wethAbi = viem.parseAbi(["function deposit() payable"]);
const encode = (name, method, args) => viem.encodeFunctionData({ abi: artifact(name).abi, functionName: method, args });
const amounts = base ? { collateral: 200_000_000_000_000n, limit: 100_000n, draw: 100_000n, bond: 20_000n } : kuru ? { collateral: viem.parseEther("0.3"), limit: 10_000n, draw: 10_000n, bond: 20_000n }
  : native ? { collateral: viem.parseEther("2"), limit: 100_000n, draw: 100_000n, bond: 20_000n }
  : { collateral: 200_000_000_000_000n, limit: 2_000_000n, draw: 1_000_000n, bond: 20_000n };
const numericQuote = ["sourceChain", "collateralAmount", "limit", "setupDeadline", "maturity", "gracePeriod", "reservationBond", "nonce", "expiry", "aprBps", "originationFee", "commitmentFeeBps"];
const quoteValue = (quote) => Object.fromEntries(Object.entries(quote).map(([key, value]) => [key, numericQuote.includes(key) ? BigInt(value) : value]));

async function main() {
  const runtime = await testnetRuntime(journalName, false);
  const { deployment, report, persist, account } = runtime;
  const monad = await runtime.context(10143);
  const sourceChainId = native ? 10143 : base ? 84532 : 11155111;
  const source = native ? monad : await runtime.context(sourceChainId);
  const m = deployment.addresses[10143];
  const s = deployment.addresses[sourceChainId];
  const usdc = deployment.tokens[10143].USDC;
  const nativeSetup = native ? readConfiguration("native") : undefined;
  const weth = native ? nativeSetup.asset : deployment.tokens[sourceChainId].WETH;
  const collateralVault = native ? m.NativeCollateralVault : s.CollateralVault;
  const appSetup = readConfiguration(kuru ? "kuru-integration" : "app");
  if (!appSetup || appSetup.core.toLowerCase() !== m.TermbookCore.toLowerCase()) throw new Error("Configure the current integration first");
  const app = kuru ? appSetup.definition.contracts.reader : appSetup.addresses.ReferenceAssetApp;
  const sdk = kuru ? await import("../packages/sdk/dist/index.js") : undefined;
  if (kuru) {
    if (Boolean(appSetup.definition.assessment?.orders) !== orders) throw new Error("Use --kuru-orders for the tracked-order integration, or --kuru for the atomic integration");
    if (report.bundleId && report.bundleId !== appSetup.bundleId) throw new Error("Live test journal belongs to another integration version");
    report.bundleId = appSetup.bundleId;
  }
  const coreRead = (name, args = []) => monad.read("TermbookCore", m.TermbookCore, name, args);
  async function currentGuards() {
    const deadline = Date.now() + 180_000;
    for (;;) {
      const block = await monad.client.getBlock();
      const leases = await Promise.all(Object.values(deployment.configuration["kuru-market"].guards).map((guard) =>
        monad.read("TestnetUpgradeGuard", guard.address, "validUntil")));
      if (leases.every((lease) => lease >= block.timestamp + 30n)
        && await monad.read("IntegrationRegistry", m.IntegrationRegistry, "dependenciesValid", [appSetup.bundleId])) return leases.reduce((minimum, lease) => lease < minimum ? lease : minimum) - 10n;
      if (Date.now() >= deadline) throw new Error("Kuru dependency guards are not sufficiently current");
      await delay(3_000);
    }
  }
  const readPosition = (test) => kuru ? monad.read(appSetup.definition.assessment ? "UseCaseReader" : "AtomicSpotModule", app, "positionCount", [test.creditId, test.account])
    : monad.read("ReferenceAssetApp", app, "positions", [test.account]);
  if (mode === "--close-unused") {
    if (!native || !report.cases || Object.values(report.cases).some((test) => test.drawVerified)) throw new Error("Cleanup requires unused native test facilities");
    if (kuru) await currentGuards();
    for (const test of Object.values(report.cases)) {
      let credit = await coreRead("creditDetails", [test.creditId]);
      const pending = kuru ? await monad.read(appSetup.definition.assessment ? "UseCaseReader" : "AtomicSpotModule", app, "pendingCount", [test.creditId, test.account]) : 0n;
      if (credit.debt !== 0n || await readPosition(test) !== 0n || pending !== 0n
        || await monad.client.getBalance({ address: test.account }) !== 0n
        || await monad.client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [test.account] }) !== 0n) throw new Error("Unused test has funds or obligations");
      if ([4, 5].includes(credit.facility) && !credit.collateralReturned) {
        if (credit.facility === 4) await monad.call("TermbookCore", m.TermbookCore, "startClosing", [test.creditId], `${test.kind}:close-unused`);
        credit = await coreRead("creditDetails", [test.creditId]);
        await monad.call("TermbookCore", m.TermbookCore, "authorizeReturn", [test.creditId, test.lockId, credit.collateralAmount], `${test.kind}:return-unused`);
      }
      credit = await coreRead("creditDetails", [test.creditId]);
      if (credit.collateralReturned && credit.facility === 5) await monad.call("TermbookCore", m.TermbookCore, "finishClose", [test.creditId], `${test.kind}:close-returned-unused`);
      credit = await coreRead("creditDetails", [test.creditId]);
      if (credit.debt !== 0n || credit.facility !== 6 || !credit.collateralReturned
        || !await monad.read("CreditAccount", test.account, "released")) throw new Error("Unused test closure incomplete");
    }
    clearOperation(journalName, false);
    log(JSON.stringify({ closedUnused: true, cases: Object.keys(report.cases).length }));
    return;
  }
  async function kuruAction(test, direction, amount, credit) {
    const definition = appSetup.definition;
    const market = definition.markets[0];
    const protection = await coreRead("priceProtection");
    const slippage = Math.min(100, Number(await monad.read("PriceProtection", protection, "houseSlippage", [test.creditId])));
    const action = { use_case: "spot", capability: "place_order", params: { market_id: market.market_id,
      direction, order_type: "market", amount: { spend: amount }, slippage_bps: slippage } };
    return kuruPlan(test, action, credit, direction === "buy" ? amounts.draw : 0n);
  }
  const sellMaximum = kuru ? BigInt(appSetup.definition.assessment?.calls.find((call) => call.target.toLowerCase()
    === appSetup.definition.assessment.routes.router.toLowerCase() && call.selector === "0x69b64678")?.native_maximum ?? viem.parseEther("1")) : 0n;
  async function kuruPlan(test, action, credit, draw = 0n) {
    await currentGuards();
    const definition = appSetup.definition, market = definition.markets[0];
    const buying = action.params.direction === "buy", limit = action.params.order_type === "limit";
    const protection = await coreRead("priceProtection");
    const selected = selectCapability(definition.actions, action);
    let quote = { roundId: 0n, referencePrice: 0n, updatedAt: 0n, authorizedAt: 0n, bound: 0n, slippageBps: 0, isMax: false }, bound;
    if (selected.price) {
      const slippage = Math.min(100, Number(await monad.read("PriceProtection", protection, "houseSlippage", [test.creditId])));
      const priceArgs = [appSetup.bundleId, viem.keccak256(viem.stringToHex(executionKey(selected))), viem.keccak256(viem.stringToHex(market.market_id))];
      let price;
      try { price = await monad.read("PriceProtection", protection, "priceReference", priceArgs); }
      catch (error) {
        const reverted = typeof error?.walk === "function" ? error.walk((item) => item.name === "ContractFunctionRevertedError") : undefined;
        if (reverted?.data?.errorName !== "Stale") throw error;
        await monad.call("PriceProtection", protection, "recordPrice", priceArgs, `${test.kind}:${executionKey(selected)}:price:${await monad.client.getBlockNumber()}`);
        price = await monad.read("PriceProtection", protection, "priceReference", priceArgs);
      }
      if (limit) {
        const params = await marketParams();
        bound = BigInt(action.params.limit_price) * BigInt(params[0]) / 10n ** 18n;
      } else bound = await monad.read("PriceProtection", protection, "deriveAmountBound", [price[0], BigInt(action.params.amount.spend), slippage,
        buying ? market.quote_decimals : market.base_decimals, buying ? market.base_decimals : market.quote_decimals, buying, false]);
      quote = { roundId: price[2], referencePrice: price[0], updatedAt: price[1], authorizedAt: 0n,
        bound, slippageBps: slippage, isMax: limit && buying };
    }
    const guardDeadline = await currentGuards();
    const block = await monad.client.getBlock();
    if (selected.price) quote.authorizedAt = block.timestamp;
    const plan = sdk.buildExecution(selected, action, { borrower: account.address,
      account: test.account, creditId: test.creditId, use_case: "spot", priceBound: bound }, usdc);
    if (draw > plan.requiredInput) draw = plan.requiredInput;
    const authorization = { drawAmount: draw, maxDraw: draw,
      nonce: credit.nonce + 1n, deadline: guardDeadline < block.timestamp + 90n ? guardDeadline : block.timestamp + 90n, revision: credit.revision, signer: account.address, signature: "0x",
      price: quote };
    authorization.signature = await account.signMessage({ message: { raw: await coreRead("executionDigest", [test.creditId, plan, authorization]) } });
    return JSON.parse(canonicalJson({ plan, authorization, probe: { action, credit_id: test.creditId,
      ...(limit ? { price_bound: bound } : bound !== undefined ? { minimum_receive: bound } : {}) } }));
  }
  const marketParams = () => monad.client.readContract({ address: appSetup.definition.markets[0].address,
    abi: viem.parseAbi(["function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)"]), functionName: "getMarketParams" });
  async function restingPrice(direction) {
    const market = appSetup.definition.markets[0], params = await marketParams();
    const book = await monad.client.readContract({ address: market.address,
      abi: viem.parseAbi(["function getL2Book(uint32,uint32) view returns(bytes)"]), functionName: "getL2Book", args: [1, 1] });
    const words = viem.decodeAbiParameters(Array.from({ length: (book.length - 2) / 64 }, () => ({ type: "uint256" })), book);
    const bid = words[1], ask = words[4], tick = BigInt(params[6]);
    if (bid <= 0n || ask <= bid + tick) throw new Error("Kuru needs a resting price between the live bid and ask");
    return (direction === "buy" ? bid + tick : ask + tick) * 10n ** 18n / BigInt(params[0]);
  }
  async function executeProbe(test, key, action, draw = 0n) {
    test.orderTests ??= {};
    let step = test.orderTests[key];
    const label = `${test.kind}:${key}`, recorded = report.transactions.find((tx) => tx.name === label);
    if (step && !recorded && BigInt(step.authorization.deadline) <= (await monad.client.getBlock()).timestamp) {
      delete test.orderTests[key]; step = undefined; persist();
    }
    if (!step) {
      step = test.orderTests[key] = await kuruPlan(test, action, await coreRead("creditDetails", [test.creditId]), draw);
      persist();
    }
    const tx = await monad.call("TermbookCore", m.TermbookCore, "executePlan", [test.creditId, step.plan, step.authorization], label);
    step.probe.tx_hash = tx.hash; persist(); return step;
  }
  async function orderProbes(test) {
    if (test.ordersVerified) return;
    const market = appSetup.definition.markets[0], tracker = appSetup.definition.assessment.orders.tracker;
    const sell = { use_case: "spot", capability: "place_order", params: { market_id: market.market_id, direction: "sell", order_type: "market",
      amount: { spend: (await monad.client.getBalance({ address: test.account })) / 4n }, slippage_bps: 100 } };
    await executeProbe(test, "seed-orders", sell);
    for (const direction of ["buy", "sell"]) for (const sizing of ["spend", "receive"]) {
      const key = `limit-${direction}-${sizing}`;
      if (test.orderTests[key]?.cancelled) continue;
      if (!test.orderTests[key]) {
        const price = await restingPrice(direction), params = await marketParams();
        const lot = 10n ** BigInt(market.base_decimals) / params[1];
        const baseQuantity = viem.parseEther("0.01") / lot * lot;
        const amount = direction === "buy" ? sizing === "spend" ? 1000n : baseQuantity
          : sizing === "spend" ? baseQuantity : baseQuantity * price * 10n ** BigInt(market.quote_decimals) / (10n ** 18n * 10n ** BigInt(market.base_decimals));
        const action = { use_case: "spot", capability: "place_order", params: { market_id: market.market_id, direction,
          order_type: "limit", amount: { [sizing]: amount }, limit_price: price } };
        await executeProbe(test, key, action);
      }
      const placed = await executeProbe(test, key, test.orderTests[key].probe.action);
      const receipt = await monad.client.getTransactionReceipt({ hash: placed.probe.tx_hash });
      const events = viem.parseEventLogs({ abi: artifact("SpotOrderTracker").abi, logs: receipt.logs,
        eventName: "OrderCaptured" }).filter((event) => event.address.toLowerCase() === tracker.toLowerCase()
          && event.args.creditId === test.creditId);
      if (events.length !== 1) throw new Error("Limit test must capture one resting order");
      await executeProbe(test, `cancel-${direction}-${sizing}`, { use_case: "spot", capability: "cancel_order", params: { order_id: String(events[0].args.venueId) } });
      const pending = await monad.read("UseCaseReader", app, "pendingCount", [test.creditId, test.account]);
      if (pending !== 0n) throw new Error("Limit cancellation left a pending obligation");
      placed.cancelled = true; persist();
    }
    const health = await coreRead("previewHealth", [test.creditId]);
    if (health.appValue <= 0n || health.healthBps < 12_500n) throw new Error("Controlled venue funds are missing from healthy backing");
    test.ordersVerified = new Date().toISOString(); persist();
  }
  const now = (await monad.client.getBlock()).timestamp;
  if (!m.AccountHealthSource || (await coreRead("healthSource")).toLowerCase() !== m.AccountHealthSource.toLowerCase()) throw new Error("Authenticated health source is required");
  if (kuru && mode !== "--observe") {
    await sdk.verify_definition(monad.client, appSetup.definition);
    await currentGuards();
  }
  if (!kuru && !await monad.read("IntegrationRegistry", m.IntegrationRegistry, "isActive", [appSetup.bundleId])) throw new Error("Test application is inactive");
  if (kuru && !base) {
    if (!report.collateralAmount || report.collateralSizingVersion !== 2) {
      const [price, policy] = await Promise.all([
        monad.read("OracleRegistry", m.OracleRegistry, "read", [nativeSetup.priceId]),
        monad.read("HouseRegistry", m.HouseRegistry, "policies", [account.address]),
      ]);
      if (!policy[12] || !policy[13]) throw new Error("Kuru House risk policy is inactive");
      const risk = appSetup.definition.assessment ?? appSetup.definition.atomic_spot;
      const costs = BigInt(nativeSetup.recoveryCosts) + BigInt(risk.recovery_costs);
      const target = ((amounts.draw + costs) * (policy[7] + 500n) + 9_999n) / 10_000n;
      const retainedApp = amounts.draw * 9_800n * BigInt(risk.retained_bps) / 100_000_000n;
      const retainedSource = target > retainedApp ? target - retainedApp : amounts.draw / 2n;
      if (retainedSource * 10_000n >= amounts.draw * BigInt(nativeSetup.retainedSourceBps)) throw new Error("Kuru test loan is too small for its recovery costs");
      const numerator = retainedSource * 10n ** 30n * 10_000n;
      const denominator = price[0] * BigInt(nativeSetup.retainedSourceBps);
      if (denominator <= 0n) throw new Error("Kuru collateral price is unavailable");
      report.collateralAmount = String((numerator + denominator - 1n) / denominator);
      report.collateralSizingVersion = 2;
      if (mode !== "--observe") persist();
    }
    amounts.collateral = BigInt(report.collateralAmount);
  }
  if (mode !== "--observe" && !native) {
    const registry = await coreRead("verifierRegistry");
    const [verifier, version, active] = await monad.read("VerifierRegistry", registry, "verifiers", [BigInt(sourceChainId)]);
    const depth = await source.read("WormholeEthereumPublisher", s.WormholeEthereumPublisher, "confirmationDepth");
    if (!active || (fast ? version !== 2n || depth !== 5 : version !== 1n || depth !== 0)) throw new Error("E2E confirmation mode does not match the admitted deployment");
    if (fast) {
      const client = await monad.read("WormholeEthereumVerifier", verifier, "lightClient");
      if (await monad.read("WormholeSepoliaMessageClient", client, "confirmationDepth") !== 5
        || await monad.read("WormholeSepoliaMessageClient", client, "confirmationPolicyHash") !== await source.read("WormholeEthereumPublisher", s.WormholeEthereumPublisher, "confirmationPolicyHash")) throw new Error("E2E confirmation policy mismatch");
    }
  }

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

  if (mode === "--begin" || mode === "--retry-default" || mode === "--start" && !report.begun) {
    if (!(await globalThis.fetch(`${api}/ready`)).ok) throw new Error("Local services are not ready");
    await post("/houses", { house: account.address, vault: m.HouseVault, asset: usdc, manager: account.address });
    report.startedAt ??= new Date().toISOString();
    report.cases ??= {};
    persist();
    const policyHash = await monad.read("ReservationManager", m.ReservationManager, "policyHashes", [account.address, 1n]);
    if (mode === "--retry-default") {
      const previous = report.cases.default;
      const previousCredit = previous && await coreRead("creditDetails", [previous.creditId]);
      if (!previous || previous.drawVerified || previousCredit.debt !== 0n || previousCredit.nonce !== 0n
        || ![5, 6, 7].includes(previousCredit.facility)
        || previousCredit.facility === 5 && (!previous.returnTx || previous.failure !== "matured_before_borrowing")
        || await readPosition(previous) !== 0n
        || kuru && await monad.read("UseCaseReader", app, "pendingCount", [previous.creditId, previous.account]) !== 0n
        || await monad.client.getBalance({ address: previous.account }) !== 0n
        || await monad.client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [previous.account] }) !== 0n) {
        throw new Error("Return the unused default facility before retrying");
      }
    }
    for (const kind of mode === "--retry-default" ? ["default-retry"] : fast ? ["repayment"] : base ? ["repayment", "default"] : kuru ? ["repayment", "default", "active"] : ["repayment", "default"]) {
      let test = report.cases[kind];
      if (!test) {
        const nonce = BigInt(Date.now());
        const intentId = viem.keccak256(viem.stringToHex(`Termbook live E2E:${kind}:${report.startedAt}`));
        const creditId = viem.keccak256(viem.encodeAbiParameters(viem.parseAbiParameters("bytes32,address,address,uint256"),
          [intentId, account.address, account.address, nonce]));
        const lockId = viem.keccak256(viem.encodeAbiParameters(viem.parseAbiParameters("bytes32,string"), [creditId, "source-lock"]));
        const quotedAt = (await monad.client.getBlock()).timestamp;
        const setupDeadline = quotedAt + (native ? 300n : kind === "default-retry" ? 2700n : base ? 3600n : 1800n);
        const quote = { borrower: account.address, owner: account.address, intentId, house: account.address,
          vault: m.HouseVault, sourceChain: BigInt(sourceChainId), collateralVault,
          collateralAsset: weth, collateralAmount: amounts.collateral, returnRecipient: account.address,
          settlementAsset: usdc, limit: amounts.limit, bundleId: appSetup.bundleId,
          setupDeadline, maturity: kind.startsWith("default") ? setupDeadline + 120n : setupDeadline + 43_200n,
          gracePeriod: 60n, reservationBond: amounts.bond, nonce, expiry: setupDeadline,
          termsHash: viem.keccak256(viem.stringToHex(`Termbook ${kuru ? "Kuru" : "reference app"} ${kind} live test`)),
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
      if (!native) await monad.call("TermbookCore", m.TermbookCore, "bindRemoteCollateral", [test.creditId, test.lockId], `${kind}:bind-lock`);
      await monad.call("AccountFactory", m.AccountFactory, "create", [test.creditId, account.address, m.TermbookCore], `${kind}:create-account`);
      test.account = await monad.read("AccountFactory", m.AccountFactory, "accountOf", [test.creditId]);
      await monad.call("TermbookCore", m.TermbookCore, "bindAccount", [test.creditId, test.account], `${kind}:bind-account`);
      test.lockRevision ??= String(await coreRead("creditRevision", [test.creditId]));
      persist();
      if (native) {
        const tx = await monad.send(`${kind}:lock-MON`, encode("NativeCollateralVault", "lockNativeWithDeadline", [test.lockId,
          test.creditId, account.address, amounts.collateral, account.address, quote.setupDeadline, BigInt(test.lockRevision)]), collateralVault, amounts.collateral);
        test.lockTx = tx.hash;
        await monad.call("TermbookCore", m.TermbookCore, "bindCollateral", [test.creditId, test.lockId], `${kind}:bind-lock`);
      } else {
        await source.send(`${kind}:wrap-ETH`, viem.encodeFunctionData({ abi: wethAbi, functionName: "deposit" }), weth, amounts.collateral);
        await source.send(`${kind}:approve-WETH`, viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [s.CollateralVault, amounts.collateral] }), weth);
        const tx = await source.call("CollateralVault", s.CollateralVault, "lockRemoteWithDeadline", [test.lockId, test.creditId,
          account.address, account.address, amounts.collateral, account.address, quote.setupDeadline, BigInt(test.lockRevision)], `${kind}:lock-WETH`);
        test.lockTx = tx.hash;
        await post("/collateral", { lockId: test.lockId, creditId: test.creditId, owner: account.address, amount: String(amounts.collateral) });
      }
      test.state = "awaiting_collateral_proof";
      persist();
    }
    report.begun = true; persist();
  }

  if (!report.cases) throw new Error("Run --begin first");
  if (mode === "--advance" || mode === "--run" || mode === "--start") {
    for (const test of Object.values(report.cases)) {
      let credit = await coreRead("creditDetails", [test.creditId]);
      if (kuru && test.kind.startsWith("default") && !test.drawVerified && credit.facility === 4 && now >= credit.maturity) {
        await monad.call("TermbookCore", m.TermbookCore, "startClosing", [test.creditId], `${test.kind}:close-unused`);
        test.failure = "matured_before_borrowing";
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      if ([0, 1, 2, 3].includes(credit.facility) && now > credit.setupDeadline) {
        await monad.call("TermbookCore", m.TermbookCore, "abort", [test.creditId], `${test.kind}:abort-expired-setup`);
        test.failure = "setup_expired_before_borrowing";
        test.state = "setup_aborted";
        persist();
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      if (credit.facility === 4 && !test.drawVerified) {
        const drawLabel = `${test.kind}:borrow-and-deposit`;
        const attempts = report.transactions.filter((tx) => tx.name === drawLabel || tx.name.startsWith(`${drawLabel}:retry:`));
        const failed = attempts.at(-1);
        if (test.execution && !failed && BigInt(test.execution.deadline) <= (await monad.client.getBlock()).timestamp) {
          delete test.execution; delete test.action; delete test.probe; persist();
        }
        if (failed?.status === "reverted") {
          const receipt = await monad.client.getTransactionReceipt({ hash: failed.hash });
          if (receipt.status !== "reverted" || receipt.blockHash !== failed.blockHash || credit.debt !== 0n
            || credit.nonce + 1n !== BigInt(test.execution.nonce)) throw new Error("Failed draw reconciliation mismatch");
          if (attempts.length >= 3) throw new Error("Draw retry limit reached");
          delete test.execution; delete test.action; delete test.probe; persist();
        }
        if (kuru && native && credit.collateralAmount < amounts.collateral) {
          if (attempts.some((tx) => tx.status !== "reverted")) throw new Error("Reconcile the prepared draw before changing collateral");
          const added = amounts.collateral - credit.collateralAmount;
          await monad.send(`${test.kind}:collateral-cost-buffer`, encode("TermbookCore", "addCollateral", [test.creditId, added, 0n]), m.TermbookCore, added);
          delete test.execution; delete test.action; delete test.probe; persist();
          credit = await coreRead("creditDetails", [test.creditId]);
        }
        if (kuru && !test.execution) {
          const action = orders && test.kind.startsWith("default") ? await kuruPlan(test, { use_case: "spot", capability: "place_order",
            params: { market_id: appSetup.definition.markets[0].market_id, direction: "buy", order_type: "limit",
              amount: { spend: base ? 10_000n : amounts.draw }, limit_price: await restingPrice("buy") } }, credit, base ? 10_000n : amounts.draw)
            : await kuruAction(test, "buy", amounts.draw, credit);
          test.action = action.plan; test.execution = action.authorization; test.probe = action.probe; persist();
        }
        test.action ??= { capability: viem.keccak256(viem.stringToHex("deposit")),
          market: viem.keccak256(viem.stringToHex("Termbook reference USDC position")),
          calls: [{ target: app, spendToken: usdc, spendAmount: String(amounts.draw), nativeValue: "0",
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
        const executed = await monad.call("TermbookCore", m.TermbookCore, "executePlan", [test.creditId, test.action, test.execution],
          failed?.status === "reverted" ? `${drawLabel}:retry:${attempts.length}` : failed?.name ?? drawLabel);
        if (kuru) { test.probe.tx_hash = executed.hash; persist(); }
        const [health, position, cash] = await Promise.all([
          coreRead("previewHealth", [test.creditId]), readPosition(test),
          monad.client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [test.account] }),
        ]);
        const expectedDraw = BigInt(test.execution.drawAmount);
        const resting = orders && test.kind.startsWith("default");
        const pending = orders ? await monad.read("UseCaseReader", app, "pendingCount", [test.creditId, test.account]) : 0n;
        if (health.debt !== expectedDraw || (kuru ? health.appValue <= 0n || (!resting && position !== 1n)
          || resting && pending !== 1n : health.appValue !== amounts.draw || position !== amounts.draw)
          || cash !== 0n || !base && health.sourceValue >= health.debt || health.healthBps < 12_500n) throw new Error("Live draw or valuation mismatch");
        test.drawVerified = { at: new Date().toISOString(), ...JSON.parse(canonicalJson(health)), appPosition: String(position), accountCash: String(cash) };
        test.state = test.kind.startsWith("default") ? "awaiting_default" : test.kind === "active" ? "active_for_admission" : "repayment_pending";
        persist();
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      if (base && test.kind.startsWith("default") && test.drawVerified && !test.roundingRepaid && credit.facility === 4) {
        const rounding = BigInt(test.drawVerified.debt) - BigInt(test.drawVerified.appValue);
        if (rounding < 0n || rounding > 1n || now >= credit.maturity) throw new Error("Unexpected resting-order rounding cost");
        if (rounding > 0n) {
          await monad.send(`${test.kind}:approve-rounding`, viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [m.TermbookCore, rounding] }), usdc);
          await monad.call("TermbookCore", m.TermbookCore, "repay", [test.creditId, rounding], `${test.kind}:repay-rounding`);
        }
        test.roundingRepaid = { amount: String(rounding), at: new Date().toISOString() }; persist();
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      if (orders && test.kind === "active" && test.drawVerified && credit.facility === 4) await orderProbes(test);
      if (test.kind === "repayment" && test.drawVerified && credit.facility === 4) {
        if (kuru) {
          test.sells ??= {};
          for (let step = 0; step < 16 && await monad.client.getBalance({ address: test.account }) > 0n; step++) {
            const label = step === 0 ? "repayment:sell" : `repayment:sell:${step}`;
            if (report.transactions.some((tx) => tx.name === label && tx.status === "success")) continue;
            let sale = step === 0 ? test.sell : test.sells[step];
            if (sale && !report.transactions.some((tx) => tx.name === label)
              && (BigInt(sale.authorization.deadline) <= (await monad.client.getBlock()).timestamp
                || sale.plan.calls.some((call) => BigInt(call.nativeValue) > sellMaximum))) sale = undefined;
            if (!sale) {
              const balance = await monad.client.getBalance({ address: test.account });
              sale = await kuruAction(test, "sell", balance < sellMaximum ? balance : sellMaximum, await coreRead("creditDetails", [test.creditId]));
              if (step === 0) test.sell = sale; else test.sells[step] = sale;
              persist();
            }
            const sold = await monad.call("TermbookCore", m.TermbookCore, "executePlan", [test.creditId, sale.plan, sale.authorization], label);
            sale.probe.tx_hash = sold.hash; persist();
          }
          if (await monad.client.getBalance({ address: test.account }) > 0n) throw new Error("Kuru sell step limit reached");
          await monad.call("TermbookCore", m.TermbookCore, "repayAvailableCash", [test.creditId], "repayment:repay-cash");
          const remainder = await coreRead("creditDebt", [test.creditId]);
          if (remainder > 0n) {
            await monad.send("repayment:approve-shortfall", viem.encodeFunctionData({ abi: erc20, functionName: "approve", args: [m.TermbookCore, remainder] }), usdc);
            await monad.call("TermbookCore", m.TermbookCore, "repay", [test.creditId, remainder], "repayment:repay-shortfall");
          }
          const excess = await monad.client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [test.account] });
          if (excess > 0n) await monad.call("TermbookCore", m.TermbookCore, "withdraw", [test.creditId, usdc, account.address, excess], "repayment:return-excess-cash");
        } else {
          await monad.call("TermbookCore", m.TermbookCore, "exitApp", [test.creditId, viem.encodeAbiParameters(viem.parseAbiParameters("uint256"), [amounts.draw])], "repayment:exit-app");
          await monad.call("TermbookCore", m.TermbookCore, "repayFromAccount", [test.creditId, amounts.draw], "repayment:repay");
        }
        await monad.call("TermbookCore", m.TermbookCore, "startClosing", [test.creditId], "repayment:start-closing");
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      const returnAllowed = credit.debt === 0n && !credit.collateralReturned
        && (credit.facility === 7 || test.failure === "matured_before_borrowing" && credit.facility === 5
          || test.drawVerified && (credit.facility === 5 || [8, 9].includes(credit.facility)));
      if (returnAllowed && !test.returnTx) {
        const wormhole = native ? undefined : await coreRead("ethereumWormholeCore");
        const fee = native ? 0n : await monad.client.readContract({ address: wormhole,
          abi: viem.parseAbi(["function messageFee() view returns(uint256)"]), functionName: "messageFee" });
        const tx = await monad.send(`${test.kind}:authorize-return`, encode("TermbookCore", "authorizeReturn", [test.creditId, test.lockId, credit.collateralAmount]), m.TermbookCore, fee);
        test.returnTx = tx.hash;
        persist();
      }
      if (!native && test.returnTx && !credit.collateralReturned) {
        test.returnActionHash ??= await coreRead("remoteReturnActionHash", [test.creditId]);
        if (!test.returnRegistered) {
          const response = await globalThis.fetch(`${api}/collateral/actions?creditId=${test.creditId}`);
          if (!response.ok) throw new Error("Return receipt index unavailable");
          const records = await response.json();
          if (!Array.isArray(records)) throw new Error("Invalid return receipt index");
          if (!records.some((record) => record.creditId === test.creditId && record.kind === 0
            && record.authorizationTxHash === test.returnTx && record.actionHash === test.returnActionHash)) {
            await post("/collateral/actions", { creditId: test.creditId, kind: "release", authorizationTxHash: test.returnTx });
          }
          test.returnRegistered = true;
        }
        test.state = "awaiting_collateral_return";
        persist();
      }
      credit = await coreRead("creditDetails", [test.creditId]);
      if (credit.collateralReturned && credit.facility === 5) {
        await monad.call("TermbookCore", m.TermbookCore, "finishClose", [test.creditId], `${test.kind}:finish-close`);
      }
      if (test.kind.startsWith("default") && test.drawVerified && credit.debt === 0n && credit.collateralReturned && [8, 9].includes(credit.facility)) {
        await monad.call("HouseVault", m.HouseVault, "finalizeRecovery", [test.creditId], `${test.kind}:finalize-recovery`);
        credit = await coreRead("creditDetails", [test.creditId]);
      }
      if (test.kind.startsWith("default") && test.drawVerified && credit.debt === 0n && credit.collateralReturned
        && credit.facility === 10 && !await monad.read("CreditAccount", test.account, "released")) {
        await monad.call("TermbookCore", m.TermbookCore, "releaseLiquidatedAccount", [test.creditId], `${test.kind}:release-account`);
      }
    }
  }

  const observations = [];
  for (const test of Object.values(report.cases)) {
    const credit = await coreRead("creditDetails", [test.creditId]);
    const sourceLock = await source.read(native ? "NativeCollateralVault" : "CollateralVault", collateralVault, "locks", [test.lockId]);
    const appPosition = await readPosition(test);
    const accountReleased = await monad.read("CreditAccount", test.account, "released");
    const completed = [6, 10].includes(credit.facility) && credit.debt === 0n && credit.collateralReturned && appPosition === 0n && sourceLock[2] === 0n && accountReleased;
    if (completed) {
      test.state = "completed";
      test.completedAt ??= new Date().toISOString();
    }
    if (credit.facility === 7 && credit.collateralReturned && sourceLock[2] === 0n) test.state = "aborted_collateral_returned";
    observations.push({ kind: test.kind, creditId: test.creditId, lockId: test.lockId, account: test.account,
      state: test.state, facility: credit.facility, payment: credit.payment, debt: String(credit.debt),
      collateralReturned: credit.collateralReturned, sourceLockedAmount: String(sourceLock[2]), appPosition: String(appPosition), accountReleased,
      maturity: String(credit.maturity), grace: String(credit.grace), drawVerified: test.drawVerified, failure: test.failure, completedAt: test.completedAt, completed });
  }
  report.observedAt = new Date().toISOString();
  report.observations = observations;
  const lifecycleComplete = observations.some((test) => test.kind === "repayment" && test.completed)
    && (fast || observations.some((test) => test.kind.startsWith("default") && test.drawVerified && test.completed))
    && (!orders || base || Boolean(report.cases.active?.ordersVerified))
    && (!base || observations.every((test) => test.completed || test.state === "aborted_collateral_returned"));
  if (kuru && !base && lifecycleComplete && !report.lifecycle) {
    const recovered = Object.values(report.cases).find((test) => test.kind.startsWith("default") && test.drawVerified);
    const repayment = report.cases.repayment, active = report.cases.active;
    if (!recovered?.probe?.tx_hash || !repayment?.sell?.probe?.tx_hash || !active?.drawVerified) throw new Error("Kuru lifecycle probes are incomplete");
    const accepted = report.transactions.find((tx) => tx.name === `${recovered.kind}:accept`);
    if (!accepted?.block) throw new Error("Kuru credit acceptance receipt is missing");
    const finalized = await monad.client.getBlock({ blockTag: "finalized" });
    const logs = [];
    for (let from = BigInt(accepted.block); from <= finalized.number; from += 100n) {
      logs.push(...await monad.logClient.getLogs({ address: m.TermbookCore, fromBlock: from,
        toBlock: from + 99n < finalized.number ? from + 99n : finalized.number }));
    }
    const topic = recovered.creditId.toLowerCase();
    const recoveryTopic = viem.keccak256(viem.stringToHex("AppRecoveryStep(bytes32,address,address,bytes32)"));
    const repaymentTopic = viem.keccak256(viem.stringToHex("Repaid(bytes32,uint256,uint256)"));
    const recoveryHashes = [...new Set(logs.filter((entry) => entry.topics[0] === recoveryTopic
      && entry.topics[1]?.toLowerCase() === topic).map((entry) => entry.transactionHash))];
    if (!recoveryHashes.length) throw new Error("Kuru keeper recovery receipts are missing");
    let repaymentHash, keeper;
    for (const hash of recoveryHashes) {
      const tx = await monad.client.getTransaction({ hash });
      if (tx.from.toLowerCase() === account.address.toLowerCase() || keeper && keeper.toLowerCase() !== tx.from.toLowerCase()
        || !await coreRead("recoveryKeepers", [tx.from])) throw new Error("Kuru recovery was not performed by an independent approved keeper");
      keeper = tx.from;
    }
    for (const entry of logs.filter((log) => log.topics[0] === repaymentTopic && log.topics[1]?.toLowerCase() === topic)) {
      const tx = await monad.client.getTransaction({ hash: entry.transactionHash });
      if (["recoverAccountCash(bytes32,uint256)", "repayAvailableCash(bytes32)"].some((signature) => tx.input.startsWith(viem.toFunctionSelector(signature)))
        && tx.from.toLowerCase() === keeper.toLowerCase()) repaymentHash = tx.hash;
    }
    if (!repaymentHash) throw new Error("Kuru independent repayment receipt is missing");
    report.probes = orders ? [active.probe, repayment.sell.probe,
      ...["buy", "sell"].flatMap((direction) => ["spend", "receive"].map((sizing) => direction === "buy" && sizing === "spend"
        ? recovered.probe : active.orderTests[`limit-${direction}-${sizing}`].probe)),
      active.orderTests["cancel-buy-spend"].probe] : [recovered.probe, repayment.sell.probe];
    const advertised = appSetup.definition.actions.map(executionKey);
    const actual = report.probes.map((probe) => executionKey(selectCapability(appSetup.definition.actions, probe.action)));
    if (new Set(actual).size !== advertised.length || actual.length !== advertised.length
      || advertised.some((key) => !actual.includes(key))) throw new Error("Kuru action probes do not cover the admitted definition");
    report.lifecycle = { active_credit_id: active.creditId, recovered_credit_id: recovered.creditId,
      action_transactions: Object.fromEntries(report.probes.map((probe) => [executionKey(selectCapability(appSetup.definition.actions, probe.action)),
        { credit_id: probe.credit_id, tx_hash: probe.tx_hash }])),
      recovery_tx_hashes: recoveryHashes, repayment_tx_hash: repaymentHash };
    report.validationKeeper = keeper; persist();
  }
  if (mode !== "--observe") persist();
  writeJsonAtomic(operationFile(publicName), { network: "testnet", startedAt: report.startedAt, observedAt: report.observedAt,
    confirmationPolicy: native ? "Atomic Monad custody" : fast ? "Sepolia five-confirmation test policy" : "Full source finality",
    scope: base ? "Base Sepolia WETH custody, finalized Wormhole proofs, Kuru market buy/sell, USDC repayment, closure and independent resting-order recovery"
      : orders ? "Kuru market and limit buys and sells, cancellation, controlled venue funds, repayment, closure and independent order recovery"
      : kuru ? "Kuru market buys and sells, controlled MON holdings, USDC repayment, closure and independent keeper recovery"
      : native ? "Native MON custody, USDC borrowing, API credit tracking and independent reference app recovery"
      : "Real Sepolia WETH custody, Wormhole proofs, Monad USDC borrowing and reference app recovery",
    excluded: kuru ? "Aurora conversions and full acceptance-suite admission" : native ? "Collateral sale, Aurora conversions and real trading venues" : "Aurora conversions and real trading venue behavior",
    drawAmount: String(amounts.draw), native, core: m.TermbookCore, app, ...(kuru ? { bundleId: appSetup.bundleId } : {}), observations,
    ...(kuru && report.lifecycle ? { probes: report.probes, lifecycle: report.lifecycle, validationKeeper: report.validationKeeper } : {}),
    transactions: report.transactions.map((tx) => Object.fromEntries(Object.entries(tx).filter(([key]) => key !== "rawTransaction"))) });
  log(JSON.stringify({ observedAt: report.observedAt, cases: observations }));
  return lifecycleComplete;
}

async function run() {
  const lockPath = operationLock(journalName);
  let lock;
  if (mode !== "--observe") {
    if (fs.existsSync(lockPath)) {
      const owner = Number(fs.readFileSync(lockPath, "utf8"));
      if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("Live test lock is invalid");
      try { process.kill(owner, 0); throw new Error("Live test runner is already active"); }
      catch (cause) {
        if (cause.code !== "ESRCH") throw cause;
        fs.unlinkSync(lockPath);
      }
    }
    lock = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(lock, String(process.pid));
  }
  try {
    const deadline = Date.now() + 2 * 60 * 60 * 1000;
    do {
      let completed;
      try { completed = await main(); }
      catch (cause) {
        const transport = typeof cause?.walk === "function" ? cause.walk((item) =>
          ["HttpRequestError", "TimeoutError", "LimitExceededRpcError", "InternalRpcError"].includes(item.name)) : cause;
        if (!["--run", "--start"].includes(mode)
          || !["HttpRequestError", "TimeoutError", "LimitExceededRpcError", "InternalRpcError"].includes(transport?.name)
          || /revert|unauthorized|invalid/i.test(cause.shortMessage ?? cause.message)) throw cause;
        error(JSON.stringify({ retry: "rpc-transport", errorName: transport.name }));
        await delay(5000); continue;
      }
      if (!["--run", "--start"].includes(mode) || completed) return;
      await delay(2000);
    } while (Date.now() < deadline);
    throw new Error("Live test wait expired; resume with --run");
  } finally {
    if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockPath); }
  }
}
run().catch((cause) => {
  const reverted = typeof cause?.walk === "function" ? cause.walk((item) => item.name === "ContractFunctionRevertedError") : undefined;
  error(JSON.stringify({ message: cause instanceof Error ? cause.message.split("\n")[0] : "Live testnet E2E failed",
    ...(reverted ? { contractError: reverted.data?.errorName, selector: reverted.raw?.slice(0, 10) } : {}) }));
  process.exitCode = 1;
});
