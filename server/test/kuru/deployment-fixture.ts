import { atomic_configuration, use_case_configuration } from "@termbook/sdk";
import type { PluginDefinition, IntegrationSuite } from "@termbook/schema";
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex, zeroAddress, type Address, type Hex } from "viem";
import { Fixture, artifact, signature, USDC, MARKET, word, type Facility } from "./acceptance-fixture.js";

type Deployment = { addresses: Record<string, Record<string, Address>>; configuration: {
  "kuru-integration": { definition: PluginDefinition; healthReader: Address };
  "kuru-market": { monitor: Address; guards: Record<string, { address: Address }> };
} };

export class DeploymentFixture extends Fixture {
  override readonly bundle: Hex; override readonly buy: Hex; override readonly sell: Hex;
  override readonly buyRoute: Hex; override readonly sellRoute: Hex;
  override readonly market: Hex; override readonly feedId: Hex; override readonly program: Hex;
  sourceBlock!: IntegrationSuite["sourceBlock"];
  readonly helpers = new Set<string>();
  private readonly governance: Address;
  private readonly monitor: Address;
  private readonly usdFeed = word("Kuru acceptance fixture USD");
  private readonly deployedHouse: Address;
  constructor(rpc: string, readonly deployment: Deployment, actorKeys: Hex[]) {
    super(rpc, actorKeys);
    const deployed = deployment.addresses[10143]!;
    Object.assign(this.addresses, deployed, { Circle: USDC, Kuru: MARKET, AppHealthReader: deployment.configuration["kuru-integration"].healthReader });
    this.governance = deployed.ProtocolGovernance!;
    this.deployedHouse = deployed.HouseVault!;
    this.monitor = deployment.configuration["kuru-market"].monitor;
    const definition = deployment.configuration["kuru-integration"].definition;
    if (definition.assessment) {
      const config = use_case_configuration(definition), market = config.reader.markets[0]!;
      this.bundle = config.version_id; this.market = market.id; this.feedId = market.asset0.feed; this.program = market.asset0.quoteProgram;
      this.buy = word("kuru_buy"); this.sell = word("kuru_sell");
      this.buyRoute = definition.assessment.routes!.values[0]!.id as Hex; this.sellRoute = definition.assessment.routes!.values[1]!.id as Hex;
    } else {
      const config = atomic_configuration(definition), market = config.markets[0]!;
      this.bundle = config.version_id; this.buy = market.buyCapability; this.sell = market.sellCapability;
      this.buyRoute = market.buyRoute; this.sellRoute = market.sellRoute;
      this.market = market.marketId; this.feedId = market.feedId; this.program = market.quoteProgram;
    }
    for (const [target, pin] of Object.entries(deployment.configuration["kuru-market"].guards)) {
      this.guards.push(pin.address); this.addresses[`guard_${target}`] = pin.address;
    }
  }
  override component(name: string, method: string) {
    const definition = this.deployment.configuration["kuru-integration"].definition;
    if (name === "AtomicSpotModule" && definition.assessment) {
      const recovery = ["nextExitStep", "canExit", "recoveryCall", "recoverySpend"].includes(method);
      return { name: recovery ? "UseCaseRecovery" : "UseCaseReader", target: definition.contracts[recovery ? "recovery" : "reader"] as Address };
    }
    return super.component(name, method);
  }
  get orderDefinition() { return this.deployment.configuration["kuru-integration"].definition.assessment?.orders; }
  async limitOrder(f: Facility, amount = 10_000n, draw = amount) {
    if (!this.orderDefinition) throw new Error("validation-order-tracker-required");
    const params = await this.chain.readContract({ address: MARKET, abi: parseAbi([
      "function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)"]), functionName: "getMarketParams" });
    const price = this.bid + BigInt(params[6]);
    if (price >= this.ask) throw new Error("validation-resting-price-unavailable");
    const quantity = amount * BigInt(params[0]) * params[1] / 10n ** params[5] / price;
    const rule = this.orderDefinition.rules.find((r) => r.buy)!;
    const tracker = this.orderDefinition.tracker as Address;
    const action = { capability: word("kuru_limit_buy_spend"), market: this.market, requiredInput: amount, exposureLimit: amount,
      calls: [
        { target: rule.custody as Address, spendToken: USDC, spendAmount: amount, nativeValue: 0n,
          data: encodeFunctionData({ abi: parseAbi(["function deposit(address,address,uint256) payable"]), functionName: "deposit", args: [f.account, USDC, amount] }) },
        { target: tracker, spendToken: zeroAddress, spendAmount: 0n, nativeValue: 0n,
          data: encodeFunctionData({ abi: parseAbi(["function beginOrder(bytes32,bytes32,uint256,uint256)"]), functionName: "beginOrder", args: [f.id, rule.id as Hex, quantity * 10n ** params[3] / params[1], price] }) },
        { target: MARKET, spendToken: zeroAddress, spendAmount: 0n, nativeValue: 0n,
          data: encodeFunctionData({ abi: parseAbi(["function addBuyOrder(uint32,uint96,bool)"]), functionName: "addBuyOrder", args: [Number(price), quantity, false] }) },
        { target: tracker, spendToken: zeroAddress, spendAmount: 0n, nativeValue: 0n,
          data: encodeFunctionData({ abi: parseAbi(["function finishOrder(bytes32)"]), functionName: "finishOrder", args: [f.id] }) },
      ] };
    const [referencePrice, updatedAt, roundId] = await this.read("OracleRegistry", "read", [this.feedId]);
    return this.authorizeOrder(f, action, draw, { roundId, referencePrice, updatedAt,
      authorizedAt: (await this.chain.getBlock()).timestamp, bound: price, slippageBps: 100, isMax: true });
  }
  async cancelOrder(f: Facility, venueId: bigint) {
    const tracker = this.orderDefinition?.tracker as Address;
    if (!tracker) throw new Error("validation-order-tracker-required");
    const action = { capability: word("kuru_cancel"), market: this.market, requiredInput: 0n, exposureLimit: 0n, calls: [
      { target: tracker, spendToken: zeroAddress, spendAmount: 0n, nativeValue: 0n,
        data: encodeFunctionData({ abi: parseAbi(["function beginCancel(bytes32,address,uint256)"]), functionName: "beginCancel", args: [f.id, MARKET, venueId] }) },
      { target: MARKET, spendToken: zeroAddress, spendAmount: 0n, nativeValue: 0n,
        data: encodeFunctionData({ abi: parseAbi(["function batchCancelOrders(uint40[])"]), functionName: "batchCancelOrders", args: [[Number(venueId)]] }) },
    ] };
    return this.authorizeOrder(f, action, 0n, { roundId: 0n, referencePrice: 0n, updatedAt: 0n, authorizedAt: 0n, bound: 0n, slippageBps: 0, isMax: false });
  }
  private async authorizeOrder(f: Facility, action: Parameters<NonNullable<Parameters<Fixture["execution"]>[3]>>[0], draw: bigint,
    price: Parameters<NonNullable<Parameters<Fixture["execution"]>[3]>>[1]["price"]) {
    const credit = await this.read("TermbookCore", "creditDetails", [f.id]);
    const auth = { drawAmount: draw, maxDraw: draw, nonce: credit.nonce + 1n, deadline: (await this.chain.getBlock()).timestamp + 60n,
      revision: credit.revision, signer: this.actors.borrower, signature: "0x" as Hex, price };
    const digest = await this.read("TermbookCore", "executionDigest", [f.id, action, auth]);
    auth.signature = await this.keys[0]!.sign({ hash: digest });
    return { to: this.addresses.TermbookCore!, from: this.actors.borrower, signature: await signature("TermbookCore", "executePlan"), args: [f.id, action, auth] };
  }
  override async deploy(name: string, args: readonly unknown[] = []) {
    const address = await super.deploy(name, args); this.helpers.add(address.toLowerCase()); return address;
  }
  async candidateReads() {
    const original = { ...this.addresses };
    for (const name of ["SpotOrderTracker", "UseCaseReader"]) {
      const deployed = await this.deploy(name, [this.governance, original.TermbookCore,
        original.IntegrationRegistry, original.ReadProgram]);
      await this.rpcCall("anvil_setCode", [original[name], await this.chain.getBytecode({ address: deployed })]);
      this.addresses[name] = original[name]!; this.helpers.add(original[name]!.toLowerCase());
    }
    const replacement = await this.deploy("AppHealthReader", [original.TermbookCore, this.bundle,
      original.CollateralHealthReader, original.UseCaseReader, original.UseCaseRecovery]);
    await this.rpcCall("anvil_setCode", [original.AppHealthReader, await this.chain.getBytecode({ address: replacement })]);
    this.addresses.AppHealthReader = original.AppHealthReader!; this.helpers.add(original.AppHealthReader!.toLowerCase());
    const hash = async (target: Address) => keccak256((await this.chain.getBytecode({ address: target }))!);
    const pin = async (name: string, field: string, keys: readonly (Hex | Address)[], member: string | undefined, value: Hex) => {
      const layout = (await artifact(name)).storageLayout;
      const mapping = layout.storage.find((item) => item.label === field)!;
      let slot = BigInt(mapping.slot), type = mapping.type;
      for (const key of keys) {
        const current = layout.types[type]! as unknown as { key: string; value: string };
        const label = (layout.types[current.key] as unknown as { label: string }).label;
        slot = BigInt(keccak256(encodeAbiParameters([{ type: label }, { type: "uint256" }], [key, slot])));
        type = current.value;
      }
      const part = member ? layout.types[type]!.members.find((item) => item.label === member)! : { slot: "0", offset: 0 };
      if (part.offset !== 0) throw new Error("validation-candidate-storage-invalid");
      await this.rpcCall("anvil_setStorageAt", [original[name], toHex(slot + BigInt(part.slot), { size: 32 }), value]);
    };
    for (const name of ["SpotOrderTracker", "UseCaseReader"]) {
      await pin("IntegrationRegistry", "dependencies", [this.bundle, original[name]!], "codeHash", await hash(original[name]!));
    }
    for (const call of this.deployment.configuration["kuru-integration"].definition.assessment?.calls ?? []) {
      if (call.target.toLowerCase() !== original.SpotOrderTracker!.toLowerCase()) continue;
      const keys = [this.bundle, original.SpotOrderTracker!, call.selector as Hex];
      const codeHash = await hash(original.SpotOrderTracker!);
      await pin("IntegrationRegistry", "callCodeHashes", keys, undefined, codeHash);
      await pin("IntegrationRegistry", "callPolicies", keys, "codeHash", codeHash);
      if (call.recovery) await pin("IntegrationRegistry", "recoveryCallPolicies", keys, "codeHash", codeHash);
    }
    await pin("FlowExecutor", "bundles", [this.bundle], "readerCodeHash", await hash(original.UseCaseReader!));
    await pin("HealthSource", "readers", [this.bundle], "codeHash", await hash(original.AppHealthReader!));
    await this.mine();
  }
  async warmCredits(ids: string[]) {
    const slots: { target: Address; slot: Hex }[] = [];
    for (const name of ["TermbookCore", "RiskEngine", "ReservationManager", "AccountFactory"]) {
      const layout = (await artifact(name)).storageLayout;
      for (const id of ids) {
        if (this.facilities.has(id)) throw new Error("validation-credit-already-mutated");
        const intent = word(`Kuru deployed acceptance:${id}`);
        const credit = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }], [intent, this.actors.borrower, this.actors.keeper, BigInt(intent)]));
        for (const field of layout.storage.filter((entry) => entry.type.startsWith("t_mapping(t_bytes32,") && !layout.types[entry.type]!.value.startsWith("t_mapping"))) {
          const base = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [field.label === "intentUsed" ? intent : credit, BigInt(field.slot)])));
          const count = Math.ceil(Number(layout.types[layout.types[field.type]!.value]!.numberOfBytes) / 32);
          for (let offset = 0; offset < count; offset++) slots.push({ target: this.addresses[name]!, slot: toHex(base + BigInt(offset), { size: 32 }) });
        }
      }
    }
    const runtimePath = new URL("../../../scripts/testnet-runtime.mjs", import.meta.url).href;
    const { warmForkStorage } = await import(runtimePath);
    await warmForkStorage(this.chain, slots, (completed: number, total: number) => {
      if (completed % 256 === 0 || completed === total) process.stdout.write(`Loaded ${completed}/${total} facility storage slots\n`);
    });
  }
  override async call(name: string, method: string, args: readonly unknown[] = [], from = this.actors.borrower, target = this.addresses[name]!) {
    if (from === this.actors.borrower && ((name === "TermbookCore" && ["setLocalCollateralVault", "setPaused", "configureReservationPolicy"].includes(method))
      || ["OracleRegistry", "CollateralHealthReader", "IntegrationRegistry"].includes(name) || name === "HouseRegistry" && method === "register"
      || name === "TestnetUpgradeGuard" && method === "revoke")) from = this.governance;
    return super.call(name, method, args, from, target);
  }
  override async refresh(price = this.price) {
    await this.call("PriceFeedFixture", "update", [price]);
    await this.call("PriceFeedFixture", "update", [100_000_000n], this.actors.borrower, this.addresses.USDPriceFeedFixture);
    await this.mine();
    for (const guard of this.guards) {
      const block = await this.chain.getBlock({ blockTag: "finalized" });
      await this.call("TestnetUpgradeGuard", "renew", [block.number, block.hash, block.timestamp], this.monitor, guard);
    }
  }
  private async controlledFeed(feed: Address, guard: Address, id = this.feedId) {
    const layout = (await artifact("OracleRegistry")).storageLayout;
    const fields = { feeds: BigInt(feed), feedCodeHash: BigInt(keccak256((await this.chain.getBytecode({ address: feed }))!)),
      maxAge: 60n, feedDecimals: 8n, active: 1n, feedGuards: BigInt(guard), guardCodeHashes: BigInt(keccak256((await this.chain.getBytecode({ address: guard }))!)) };
    for (const [name, value] of Object.entries(fields)) {
      const field = layout.storage.find((entry) => entry.label === name);
      if (!field) throw new Error("validation-oracle-storage-missing");
      const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, BigInt(field.slot)]));
      await this.rpcCall("anvil_setStorageAt", [this.addresses.OracleRegistry, slot, toHex(value, { size: 32 })]);
    }
    await this.mine();
  }
  override async setup() {
    if (!/anvil/i.test(String(await this.rpcCall("web3_clientVersion"))) || await this.chain.getChainId() !== 10143) throw new Error("validation-anvil-testnet-required");
    const node = await this.rpcCall("anvil_nodeInfo") as unknown as { forkConfig?: { forkBlockNumber?: number } };
    if (!Number.isSafeInteger(node.forkConfig?.forkBlockNumber)) throw new Error("validation-fork-source-required");
    const block = await this.chain.getBlock({ blockNumber: BigInt(node.forkConfig!.forkBlockNumber!) });
    this.sourceBlock = { number: String(block.number), hash: block.hash };
    const runtimePath = new URL("../../../scripts/testnet-runtime.mjs", import.meta.url).href;
    const { warmReadProgram } = await import(runtimePath);
    const definition = this.deployment.configuration["kuru-integration"].definition;
    const programs = definition.assessment ? use_case_configuration(definition).programs : [atomic_configuration(definition).quote_program];
    for (const program of programs) await warmReadProgram(this.chain, this.addresses.ReadProgram, encodeFunctionData({ abi: (await artifact("ReadProgram")).abi,
      functionName: "configure", args: [program.id, program.program] }));
    for (const address of [...this.keys.map((key) => key.address), this.governance, this.monitor]) await this.rpcCall("anvil_setBalance", [address, toHex(10n ** 24n)]);
    await this.rpcCall("anvil_setBlockTimestampInterval", [1]);
    const book = await this.chain.readContract({ address: MARKET, abi: parseAbi(["function getL2Book(uint32,uint32) view returns(bytes)"]), functionName: "getL2Book", args: [1, 1] });
    const words = decodeAbiParameters(Array.from({ length: (book.length - 2) / 64 }, () => ({ type: "uint256" })), book) as bigint[];
    this.bid = words[1]!; this.ask = words[4]!; this.price = this.ask + 1n;
    if (this.bid <= 1n || this.ask <= this.bid) throw new Error("validation-market-liquidity-required");
    const appFeed = await this.deploy("PriceFeedFixture"); await this.call("PriceFeedFixture", "update", [this.price]);
    await this.deploy("PriceFeedGuardFixture", [this.addresses.PriceFeedFixture]);
    await this.controlledFeed(appFeed, this.addresses.PriceFeedGuardFixture!);
    this.addresses.USDPriceFeedFixture = await this.deploy("PriceFeedFixture");
    await this.call("PriceFeedFixture", "update", [100_000_000n]);
    this.addresses.PriceFeedFixture = appFeed;
    const usdGuard = await this.deploy("PriceFeedGuardFixture", [this.addresses.USDPriceFeedFixture]);
    await this.controlledFeed(this.addresses.USDPriceFeedFixture!, usdGuard, this.usdFeed);
    const layout = (await artifact("CollateralHealthReader")).storageLayout;
    const mapping = layout.storage.find((entry) => entry.label === "markets")!;
    const id = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }], [10143n, USDC, USDC]));
    const slot = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, BigInt(mapping.slot)])));
    const slots = new Set(layout.types[layout.types[mapping.type]!.value]!.members.map((member) => member.slot));
    for (const offset of slots) await this.rpcCall("anvil_setStorageAt", [this.addresses.CollateralHealthReader, toHex(slot + BigInt(offset), { size: 32 }), toHex(0n, { size: 32 })]);
    await this.call("CollateralHealthReader", "setMarket", [10143n, USDC, USDC, this.usdFeed, 6, 10_000, 0]);
    const collateral = await this.deploy("CollateralVault", [USDC, 10143n, this.addresses.TermbookCore]);
    await this.call("TermbookCore", "setLocalCollateralVault", [collateral, keccak256((await this.chain.getBytecode({ address: collateral }))!)]);
    await this.deploy("HouseVault", [USDC, this.addresses.TermbookCore, this.actors.keeper, this.addresses.InboxFactory, zeroAddress]);
    await this.call("HouseRegistry", "register", [this.actors.keeper, this.addresses.HouseVault, USDC, this.actors.keeper]);
    await this.call("HouseRegistry", "setPolicy", [this.actors.keeper, 1n, 1_000_000n, 1n, 400n * 86400n, 0n, 0n, 0n], this.actors.keeper);
    await this.call("HouseRegistry", "setRiskPolicy", [this.actors.keeper, 13_000n, 12_000n, 11_800n, 11_500n, 11_000n], this.actors.keeper);
    await this.call("TermbookCore", "configureReservationPolicy", [this.actors.keeper, 1n,
      [this.addresses.HouseVault, 86400, 100, 100, 100, 1_000_000n, 1_000_000n, 0n, 0n, 0n, 0n, 100]]);
    const circleAbi = parseAbi(["function masterMinter() view returns(address)"]);
    const master = await this.chain.readContract({ address: USDC, abi: circleAbi, functionName: "masterMinter" });
    await this.rpcCall("anvil_setBalance", [master, toHex(10n ** 24n)]);
    await this.transact({ to: USDC, from: master, signature: "function configureMinter(address,uint256) returns(bool)", args: [this.actors.borrower, 1000_000_000n] });
    await this.transact({ to: USDC, from: this.actors.borrower, signature: "function mint(address,uint256) returns(bool)", args: [this.actors.borrower, 1000_000_000n] });
    const margin = this.deployment.configuration["kuru-integration"].definition.pins.find((pin) => pin.target.toLowerCase() === "0xd029c2d98ff85d8f64799017fe00a59b1159ce02")?.target as Address;
    if (!margin) throw new Error("validation-margin-pin-required");
    await this.transact({ to: USDC, from: this.actors.borrower, signature: "function approve(address,uint256) returns(bool)", args: [margin, 100_000_000n] });
    for (const [token, amount] of [[USDC, 100_000_000n], [zeroAddress, 50n * 10n ** 18n]] as const) {
      await this.transact({ to: margin, from: this.actors.borrower, signature: "function deposit(address,address,uint256) payable", args: [this.actors.borrower, token, amount], value: token === zeroAddress ? amount : 0n });
    }
    for (const buy of [true, false]) await this.transact({ to: MARKET, from: this.actors.borrower,
      signature: `function add${buy ? "Buy" : "Sell"}Order(uint32,uint96,bool)`, args: [Number(buy ? this.bid : this.ask), 50n * 10_000_000_000n, true] });
    for (const spender of [this.addresses.HouseVault!, collateral]) await this.transact({ to: USDC, from: this.actors.borrower,
      signature: "function approve(address,uint256) returns(bool)", args: [spender, 100_100_000n] });
    await this.call("HouseVault", "deposit", [this.actors.keeper, 100_000_000n]);
    await this.deploy("SpotAcceptanceProbe"); await this.deploy("MockERC20");
    await this.refresh();
    await this.callbackSetup([toHex(0n, { size: 32 }), toHex(0n, { size: 32 }), toHex(0n, { size: 32 }), toHex(1n, { size: 32 })]);
  }
  override async facility(id: string, collateral = 5_000n): Promise<Facility> {
    if (this.facilities.has(id)) return this.facilities.get(id)!;
    await this.refresh();
    const now = (await this.chain.getBlock()).timestamp;
    const intent = word(`Kuru deployed acceptance:${id}`), nonce = BigInt(intent), borrower = this.actors.borrower, house = this.actors.keeper;
    const credit = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }], [intent, borrower, house, nonce]));
    const lock = word(`Kuru deployed lock:${id}`), maturity = now + 365n * 86400n;
    const hash = await this.chain.readContract({ address: this.addresses.ReservationManager!, abi: parseAbi(["function policyHashes(address,uint256) view returns(bytes32)"]), functionName: "policyHashes", args: [house, 1n] });
    const quote = { borrower, owner: borrower, intentId: intent, house, vault: this.addresses.HouseVault!, sourceChain: 10143n,
      collateralVault: this.addresses.CollateralVault!, collateralAsset: USDC, collateralAmount: collateral, returnRecipient: borrower, settlementAsset: USDC,
      limit: 10_000n, bundleId: this.bundle, setupDeadline: now + 86400n, maturity, gracePeriod: 0n, reservationBond: 10n,
      nonce, expiry: now + 86400n, termsHash: word("deployed acceptance terms"), revolving: false, aprBps: 0n, originationFee: 0n, commitmentFeeBps: 0n,
      reservationPolicyHash: hash, bondPayer: borrower, bondRefundRecipient: borrower, signature: "0x" as Hex };
    const digest = await this.chain.readContract({ address: this.addresses.TermbookCore!, abi: (await artifact("TermbookCore")).abi, functionName: "quoteDigestFull", args: [quote] }) as Hex;
    quote.signature = await this.keys[1]!.sign({ hash: digest });
    await this.call("TermbookCore", "acceptQuote", [quote]);
    await this.call("CollateralVault", "lock", [lock, credit, borrower, collateral, borrower]);
    await this.call("TermbookCore", "bindCollateral", [credit, lock]);
    await this.call("AccountFactory", "create", [credit, borrower, this.addresses.TermbookCore]);
    const account = await this.read("AccountFactory", "accountOf", [credit]); this.helpers.add(account.toLowerCase());
    await this.call("TermbookCore", "bindAccount", [credit, account]); await this.call("TermbookCore", "recordHealth", [credit]);
    const value = { id: credit, lock, account, maturity, collateral }; this.facilities.set(id, value); return value;
  }
  get liveHouse() { return this.deployedHouse; }
}
