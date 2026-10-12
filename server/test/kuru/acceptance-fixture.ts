import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, createWalletClient, defineChain, http, getContractAddress, keccak256, stringToHex,
  encodeFunctionData, parseAbi, decodeAbiParameters, toHex, type Abi, type AbiFunction, type AbiParameter,
  TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Wallet, ValidationCall } from "@termbook/sdk";
import { proxyImplementationSlots, type AcceptanceCaseId } from "@termbook/schema";

export const word = (value: string) => keccak256(stringToHex(value));
export const MARKET = "0x1F57a841540fe23C2989387c18F2CB1335CBAe92" as Address;
export const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address;
export const FACTORY = "0x7EFbE105Ca7415dE98F96622173458ac1c054630" as Address;
export const GAS_LIMIT = 30_000_000n;
const zero = "0x0000000000000000000000000000000000000000" as Address;
type StorageMember = { label: string; slot: string; offset: number; type: string };
type Artifact = { abi: Abi; bytecode: { object: Hex }; storageLayout: { storage: StorageMember[];
  types: Record<string, { value: string; members: StorageMember[]; numberOfBytes: string }> } };
type ReadResults = { router: Address; predict: Address; accountOf: Address; quoteDigest: Hex; executionDigest: Hex;
  creditFacility: number; creditDebt: bigint; creditDetails: { nonce: bigint; revision: bigint; facility: number };
  read: readonly [bigint, bigint, bigint]; deriveAmountBound: bigint;
  nextExitStep: readonly [Hex, Hex, bigint]; closeStep: readonly [Hex, Hex, boolean, bigint] };
const abiCache = new Map<string, Artifact>();
export async function artifact(name: string) {
  if (!abiCache.has(name)) {
    const aliases: Record<string, string> = { SpotCallbackFixture: "SpotAcceptanceProbe.sol", SpotCollateralReader: "atomic-spot.t.sol",
      PriceFeedFixture: "price-protection.t.sol", PriceFeedGuardFixture: "price-protection.t.sol" };
    const file = resolve("contracts/evm/out", aliases[name] ?? `${name}.sol`, `${name}.json`);
    abiCache.set(name, JSON.parse(await readFile(file, "utf8")));
  }
  return abiCache.get(name)!;
}
const parameter = (p: AbiParameter): string => `${p.type.startsWith("tuple") ? `(${("components" in p ? p.components : []).map(parameter).join(",")})${p.type.slice(5)}` : p.type}${p.name ? ` ${p.name}` : ""}`;
export async function signature(name: string, method: string) {
  const fn = (await artifact(name)).abi.find((item) => item.type === "function" && item.name === method) as AbiFunction | undefined;
  if (!fn) throw new Error(`validation-function-missing:${name}:${method}`);
  return `function ${method}(${fn.inputs.map(parameter).join(",")})${fn.stateMutability === "nonpayable" ? "" : ` ${fn.stateMutability}`}${fn.outputs.length ? ` returns (${fn.outputs.map(parameter).join(",")})` : ""}`;
}
export type Facility = { id: Hex; lock: Hex; account: Address; maturity: bigint; collateral: bigint };
export type Execution = Awaited<ReturnType<Fixture["execution"]>>;

export class Fixture {
  readonly addresses: Record<string, Address> = {};
  readonly bundle = word("Kuru SDK fork acceptance");
  readonly buy = word("kuru_buy"); readonly sell = word("kuru_sell");
  readonly buyRoute = word("kuru acceptance buy"); readonly sellRoute = word("kuru acceptance sell");
  readonly market = word(MARKET.toLowerCase()); readonly feedId = word("MON/USDC"); readonly program = word("kuru acceptance quote");
  readonly wallets: Wallet[];
  readonly actors: { borrower: Address; keeper: Address; unauthorized: Address };
  readonly chain: PublicClient;
  readonly keys = [privateKeyToAccount(toHex(0xcafen, { size: 32 })), privateKeyToAccount(toHex(0xb0bn, { size: 32 })), privateKeyToAccount(toHex(0xbadn, { size: 32 }))];
  readonly facilities = new Map<string, Facility>();
  readonly guards: Address[] = [];
  bid = 0n; ask = 0n; price = 0n;
  constructor(readonly rpc: string, actorKeys?: Hex[]) {
    const url = new URL(rpc);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password) throw new Error("validation-fork-local-only");
    if (actorKeys) { if (actorKeys.length !== 3) throw new Error("validation-actors-invalid"); this.keys.splice(0, 3, ...actorKeys.map((key) => privateKeyToAccount(key))); }
    const chain = defineChain({ id: 10143, name: "Kuru acceptance fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
    this.chain = createPublicClient({ chain, transport: http(rpc, { timeout: 60_000 }), cacheTime: 0, pollingInterval: 50 }) as PublicClient;
    this.actors = { borrower: this.keys[0]!.address, keeper: this.keys[1]!.address, unauthorized: this.keys[2]!.address };
    this.wallets = this.keys.map((account) => {
      const client = createWalletClient({ account, chain, transport: http(rpc) });
      return { address: account.address, getChainId: () => client.getChainId(), signTypedData: (data) => account.signTypedData(data as never),
        signDigest: async (digest) => { const s = await account.sign({ hash: digest }); return s; },
        writeContract: async (request) => {
          const hash = await client.writeContract({ ...request, account, gasPrice: 1_000_000_000_000n } as never);
          await this.receipt(hash); await this.finalize(); return hash;
        } };
    });
  }
  async rpcCall(method: string, params: unknown[] = []) {
    return this.chain.request({ method, params } as never);
  }
  private async receipt(hash: Hex) {
    const deadline = Date.now() + 180_000;
    let nextMine = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try { return await this.chain.getTransactionReceipt({ hash }); }
      catch (error) { if (!(error instanceof TransactionReceiptNotFoundError)) throw error; }
      if (Date.now() >= nextMine) {
        await this.rpcCall("evm_mine");
        nextMine = Date.now() + 5_000;
      }
      await delay(250);
    }
    throw new Error(`validation-receipt-timeout:${hash}`);
  }
  async finalize() {
    const [latest, finalized] = await Promise.all([this.chain.getBlock({ blockTag: "latest" }), this.chain.getBlock({ blockTag: "finalized" })]);
    const depth = latest.number - finalized.number;
    if (depth > 0n) {
      await this.rpcCall("anvil_setBlockTimestampInterval", [0]);
      try { await this.rpcCall("anvil_mine", [toHex(depth), "0x0"]); }
      finally { await this.rpcCall("anvil_setBlockTimestampInterval", [1]); }
    }
  }
  async mine() { await this.rpcCall("evm_mine"); await this.finalize(); }
  async transact(request: ValidationCall) {
    const wallet = this.wallets.find((w) => w.address.toLowerCase() === request.from.toLowerCase());
    const fn = parseAbi([request.signature])[0] as AbiFunction;
    let hash: Hex;
    if (wallet) hash = await wallet.writeContract!({ address: request.to, abi: [fn], functionName: fn.name,
      args: request.args ?? [], value: request.value, gas: GAS_LIMIT, account: request.from });
    else {
      await this.rpcCall("anvil_impersonateAccount", [request.from]);
      hash = await this.rpcCall("eth_sendTransaction", [{ from: request.from, to: request.to,
        data: encodeFunctionData({ abi: [fn], functionName: fn.name, args: request.args ?? [] } as never), gas: toHex(GAS_LIMIT), gasPrice: toHex(1_000_000_000_000n), value: toHex(request.value ?? 0n) }]) as Hex;
    }
    const receipt = await this.receipt(hash);
    if (!wallet) await this.finalize();
    if (receipt.status !== "success") {
      await this.chain.simulateContract({ address: request.to, abi: [fn, ...(await artifact("TermbookCore")).abi.filter((item) => item.type === "error")],
        functionName: fn.name, args: request.args ?? [], account: request.from, value: request.value, gas: GAS_LIMIT });
      throw new Error(`validation-setup-reverted:${fn.name}:${hash}`);
    }
    return receipt;
  }
  async call(name: string, method: string, args: readonly unknown[] = [], from = this.actors.borrower, target = this.addresses[name]!) {
    return this.transact({ to: target, from, signature: await signature(name, method), args });
  }
  async read<M extends keyof ReadResults>(name: string, method: M, args: readonly unknown[] = [], target = this.addresses[name]!) {
    const component = this.component(name, method);
    return this.chain.readContract({ address: target === this.addresses[name] ? component.target : target,
      abi: (await artifact(component.name)).abi, functionName: method, args }) as Promise<ReadResults[M]>;
  }
  component(name: string, _method: string) { return { name, target: this.addresses[name]! }; }
  async deploy(name: string, args: readonly unknown[] = []) {
    const a = await artifact(name);
    const wallet = createWalletClient({ account: this.keys[0]!, transport: http(this.rpc) });
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, chain: null, gas: 28_000_000n, gasPrice: 1_000_000_000_000n });
    const receipt = await this.receipt(hash);
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`validation-deployment-failed:${name}`);
    return this.addresses[name] = receipt.contractAddress;
  }
  async refresh(price = this.price) {
    await this.call("PriceFeedFixture", "update", [price]);
    await this.mine();
    const block = await this.chain.getBlock({ blockTag: "latest" });
    for (const guard of this.guards) await this.call("TestnetUpgradeGuard", "renew", [block.number, block.hash, block.timestamp], this.actors.borrower, guard);
  }
  async restoreGuard(price = this.price) {
    const field = (await artifact("TestnetUpgradeGuard")).storageLayout.storage.find((s) => s.label === "revoked")!;
    const slot = toHex(BigInt(field.slot), { size: 32 });
    const previous = BigInt((await this.chain.getStorageAt({ address: this.guards[0]!, slot }))!);
    await this.rpcCall("anvil_setStorageAt", [this.guards[0], slot, toHex(previous & ~(255n << BigInt(field.offset * 8)), { size: 32 })]);
    await this.mine(); await this.refresh(price);
  }
  async mapping(label: string, id: Hex, value: bigint) {
    const item = (await artifact("TermbookCore")).storageLayout.storage.find((s) => s.label === label);
    if (!item) throw new Error(`validation-storage-missing:${label}`);
    const slot = keccak256(`0x${id.slice(2)}${BigInt(item.slot).toString(16).padStart(64, "0")}`);
    await this.rpcCall("anvil_setStorageAt", [this.addresses.TermbookCore, slot, toHex(value, { size: 32 })]); await this.mine();
  }
  async creditField(id: Hex, label: string, value: bigint) {
    const layout = (await artifact("TermbookCore")).storageLayout;
    const mapping = layout.storage.find((s) => s.label === "_credits")!;
    const member = layout.types[layout.types[mapping.type]!.value]!.members.find((m) => m.label === label)!;
    if (!member) throw new Error(`validation-credit-field-missing:${label}`);
    const base = BigInt(keccak256(`0x${id.slice(2)}${BigInt(mapping.slot).toString(16).padStart(64, "0")}`));
    const slot = toHex(base + BigInt(member.slot), { size: 32 });
    const old = BigInt((await this.chain.getStorageAt({ address: this.addresses.TermbookCore!, slot })) ?? "0x0");
    const bits = BigInt(layout.types[member.type]!.numberOfBytes) * 8n, shift = BigInt(member.offset) * 8n;
    const mask = (2n ** bits - 1n) << shift;
    if (value < 0n || value >= 2n ** bits) throw new Error("validation-field-range-invalid");
    await this.rpcCall("anvil_setStorageAt", [this.addresses.TermbookCore, slot, toHex((old & ~mask) | (value << shift), { size: 32 })]); await this.mine();
  }
  async setup() {
    if (await this.rpcCall("web3_clientVersion").then(String).then((v) => !/anvil/i.test(v)) || await this.chain.getChainId() !== 10143) throw new Error("validation-anvil-testnet-required");
    for (const key of this.keys) await this.rpcCall("anvil_setBalance", [key.address, toHex(10n ** 24n)]);
    this.addresses.Circle = USDC; this.addresses.Kuru = MARKET;
    const marketAbi = parseAbi(["function getL2Book(uint32,uint32) view returns(bytes)"]);
    const book = await this.chain.readContract({ address: MARKET, abi: marketAbi, functionName: "getL2Book", args: [1, 1] });
    const words = decodeAbiParameters(Array.from({ length: (book.length - 2) / 64 }, () => ({ type: "uint256" })), book) as bigint[];
    this.bid = words[1]!; this.ask = words[4]!;
    if (this.bid <= 1n || this.ask <= this.bid) throw new Error("validation-market-liquidity-required");
    this.price = this.ask + 1n;
    const nonce = await this.chain.getTransactionCount({ address: this.actors.borrower });
    const predicted = getContractAddress({ from: this.actors.borrower, nonce: BigInt(nonce + 3) });
    await this.deploy("FlowExecutor", [predicted]); await this.deploy("ReservationManager", [predicted]); await this.deploy("PriceProtection", [predicted]);
    const core = await this.deploy("TermbookCore", [this.actors.borrower, this.actors.borrower, zero,
      this.addresses.FlowExecutor, this.addresses.ReservationManager, this.addresses.PriceProtection]);
    if (core.toLowerCase() !== predicted.toLowerCase()) throw new Error("validation-core-prediction-invalid");
    await this.deploy("RiskEngine", [core]); await this.call("TermbookCore", "setRisk", [this.addresses.RiskEngine]);
    await this.deploy("IntegrationRegistry", [this.actors.borrower]); await this.call("TermbookCore", "setIntegrationRegistry", [this.addresses.IntegrationRegistry]);
    await this.deploy("OracleRegistry", [this.actors.borrower]); await this.deploy("PriceFeedFixture"); await this.call("PriceFeedFixture", "update", [this.price]);
    await this.call("OracleRegistry", "setFeed", [this.feedId, this.addresses.PriceFeedFixture, 60, 8]);
    await this.deploy("PriceFeedGuardFixture", [this.addresses.PriceFeedFixture]); await this.call("OracleRegistry", "setFeedGuard", [this.feedId, this.addresses.PriceFeedGuardFixture]);
    await this.deploy("HealthSource", [this.actors.borrower, this.addresses.OracleRegistry]); await this.call("TermbookCore", "setHealthSource", [this.addresses.HealthSource]);
    await this.deploy("AtomicSpotRouter", [this.actors.borrower, core, this.addresses.IntegrationRegistry]);
    await this.deploy("AtomicSpotModule", [this.actors.borrower, core, this.addresses.AtomicSpotRouter, this.addresses.IntegrationRegistry]);
    await this.deploy("ReadProgram", [this.actors.borrower]);
    const q = JSON.parse(await readFile("contracts/evm/test/fixtures/kuru-testnet-read.json", "utf8"));
    const programAbi = (await artifact("ReadProgram")).abi.find((v) => v.type === "function" && v.name === "configure") as AbiFunction;
    const program = decodeAbiParameters([programAbi.inputs[1]!], q.program)[0] as { queries: { expectedHash: Hex }[] };
    const paramAbi = parseAbi(["function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)"]);
    const data = encodeFunctionData({ abi: paramAbi, functionName: "getMarketParams" });
    program.queries[1].expectedHash = keccak256((await this.chain.call({ to: MARKET, data })).data!);
    await this.call("ReadProgram", "configure", [this.program, program]);
    await this.call("IntegrationRegistry", "approve", [this.bundle, word("Kuru diagnostic manifest")]);
    const depAbi = parseAbi(["function kuruAmmVault() view returns(address)", "function marginAccountAddress() view returns(address)", "function TRUSTED_FORWARDER() view returns(address)"]);
    const vault = await this.chain.readContract({ address: MARKET, abi: depAbi, functionName: "kuruAmmVault" });
    const margin = await this.chain.readContract({ address: FACTORY, abi: depAbi, functionName: "marginAccountAddress" });
    const forwarder = await this.chain.readContract({ address: FACTORY, abi: depAbi, functionName: "TRUSTED_FORWARDER" });
    for (const target of [MARKET, FACTORY, vault, margin, forwarder, USDC]) {
      let implementation = zero;
      for (const slot of proxyImplementationSlots) {
        const value = await this.chain.getStorageAt({ address: target, slot });
        if (value && BigInt(value) !== 0n) { implementation = `0x${value.slice(-40)}`; break; }
      }
      if (implementation === zero) throw new Error("validation-proxy-implementation-missing");
      this.addresses[`dependency_${target}`] = target;
      this.addresses[`implementation_${target}`] = implementation;
      const guard = await this.deploy("TestnetUpgradeGuard", [target, implementation, this.actors.borrower, this.actors.borrower]);
      this.guards.push(guard); this.addresses[`guard_${target}`] = guard;
      await this.call("IntegrationRegistry", "pinDependency", [this.bundle, target]);
    }
    await this.refresh();
    for (const [i, target] of [MARKET, FACTORY, vault, margin, forwarder, USDC].entries()) await this.call("IntegrationRegistry", "setDependencyGuard", [this.bundle, target, this.guards[i]]);
    for (const target of [this.addresses.AtomicSpotRouter!, this.addresses.AtomicSpotModule!, this.addresses.ReadProgram!, this.addresses.OracleRegistry!]) await this.call("IntegrationRegistry", "pinDependency", [this.bundle, target]);
    const words4 = [toHex(0n, { size: 32 }), toHex(0n, { size: 32 }), toHex(0n, { size: 32 }), toHex(1n, { size: 32 })];
    for (const buying of [true, false]) await this.call("AtomicSpotRouter", "configure", [buying ? this.buyRoute : this.sellRoute,
      [this.bundle, MARKET, buying ? USDC : zero, buying ? zero : USDC,
        encodeFunctionData({ abi: parseAbi([`function placeAndExecuteMarket${buying ? "Buy" : "Sell"}(uint96,uint256,bool,bool)`]), functionName: `placeAndExecuteMarket${buying ? "Buy" : "Sell"}`, args: [1n, 1n, false, true] }).slice(0, 10),
        0, 1, buying ? 100_000_000n : 10_000_000_000n, buying ? 1_000_000n : 10n ** 18n, 1n, 2n ** 96n - 1n, words4]]);
    await this.call("AtomicSpotModule", "configure", [this.bundle, USDC, 9500, 0,
      [[this.market, this.buyRoute, this.sellRoute, this.addresses.ReadProgram, 10n ** 18n, this.addresses.OracleRegistry, this.feedId, 18, 6, this.buy, this.sell, 10_000_000_000n, this.program, 100_000n]]]);
    const tradeSelector = encodeFunctionData({ abi: parseAbi(["function trade(bytes32,uint256,uint256)"]), functionName: "trade", args: [this.buyRoute, 1n, 1n] }).slice(0, 10);
    await this.call("IntegrationRegistry", "registerCall", [this.bundle, this.addresses.AtomicSpotRouter, tradeSelector, 100, 255, 1, 10n ** 18n]);
    await this.call("IntegrationRegistry", "setCallValidator", [this.bundle, this.addresses.AtomicSpotRouter, tradeSelector, this.addresses.AtomicSpotModule]);
    await this.call("IntegrationRegistry", "registerRecoveryCall", [this.bundle, this.addresses.AtomicSpotRouter, tradeSelector, 100, 255]);
    await this.call("IntegrationRegistry", "setRecoveryCallValidator", [this.bundle, this.addresses.AtomicSpotRouter, tradeSelector, this.addresses.AtomicSpotModule]);
    await this.call("IntegrationRegistry", "registerNativeValue", [this.bundle, this.addresses.AtomicSpotRouter, tradeSelector, false, 10n ** 18n, 255]);
    await this.call("IntegrationRegistry", "registerNativeValue", [this.bundle, this.addresses.AtomicSpotRouter, tradeSelector, true, 10n ** 18n, 1]);
    await this.call("TermbookCore", "configureExecutionPolicy", [this.bundle, this.addresses.AtomicSpotModule, 1, 0, 60]);
    for (const method of ["setAppRecoveryAdapter", "setExitPlanner", "setExitVerifier"]) await this.call("TermbookCore", method, [this.bundle, this.addresses.AtomicSpotModule]);
    for (const buying of [true, false]) await this.call("TermbookCore", "configureExecutionAmountPrice", [this.bundle, buying ? this.buy : this.sell, this.market,
      [this.addresses.OracleRegistry, this.feedId, this.addresses.AtomicSpotRouter, tradeSelector, 0, buying ? 18 : 6, 2, 0, 100, 500, 60, 0, 1],
      [1, buying ? 6 : 18, buying ? 18 : 6, buying, false, true, buying ? USDC : zero, buying ? zero : USDC]]);
    await this.deploy("SpotCollateralReader", [core, USDC]); await this.deploy("AppHealthReaderFactory", [core, this.addresses.SpotCollateralReader]);
    const reader = await this.read("AppHealthReaderFactory", "predict", [this.bundle, this.addresses.AtomicSpotModule, this.addresses.AtomicSpotModule]);
    await this.call("AppHealthReaderFactory", "create", [this.bundle, this.addresses.AtomicSpotModule, this.addresses.AtomicSpotModule]);
    this.addresses.AppHealthReader = reader;
    await this.call("HealthSource", "setReader", [this.bundle, reader, 1, 60]); await this.call("IntegrationRegistry", "activate", [this.bundle]);
    await this.deploy("InboxFactory", [this.actors.borrower]); await this.deploy("HouseVault", [USDC, core, this.actors.keeper, this.addresses.InboxFactory, zero]);
    const circleAbi = parseAbi(["function masterMinter() view returns(address)", "function configureMinter(address,uint256) returns(bool)", "function mint(address,uint256) returns(bool)", "function approve(address,uint256) returns(bool)"]);
    const master = await this.chain.readContract({ address: USDC, abi: circleAbi, functionName: "masterMinter" });
    await this.rpcCall("anvil_setBalance", [master, toHex(10n ** 24n)]);
    await this.transact({ to: USDC, from: master, signature: "function configureMinter(address,uint256) returns(bool)", args: [this.actors.borrower, 1000_000_000n] });
    await this.transact({ to: USDC, from: this.actors.borrower, signature: "function mint(address,uint256) returns(bool)", args: [this.actors.borrower, 1000_000_000n] });
    await this.transact({ to: USDC, from: this.actors.borrower, signature: "function approve(address,uint256) returns(bool)", args: [margin, 100_000_000n] });
    await this.transact({ to: margin, from: this.actors.borrower, signature: "function deposit(address,address,uint256) payable", args: [this.actors.borrower, USDC, 100_000_000n] });
    await this.transact({ to: margin, from: this.actors.borrower, signature: "function deposit(address,address,uint256) payable", args: [this.actors.borrower, zero, 50n * 10n ** 18n], value: 50n * 10n ** 18n });
    for (const buy of [true, false]) await this.transact({ to: MARKET, from: this.actors.borrower,
      signature: `function add${buy ? "Buy" : "Sell"}Order(uint32,uint96,bool)`, args: [Number(buy ? this.bid : this.ask), 50n * 10_000_000_000n, true] });
    await this.transact({ to: USDC, from: this.actors.borrower, signature: "function approve(address,uint256) returns(bool)", args: [this.addresses.HouseVault, 100_000_000n] });
    await this.call("HouseVault", "deposit", [this.actors.keeper, 100_000_000n]);
    await this.deploy("CollateralVault", [USDC, 10143n, core]); await this.call("TermbookCore", "setLocalCollateralVault", [this.addresses.CollateralVault, keccak256((await this.chain.getBytecode({ address: this.addresses.CollateralVault! }))!)]);
    await this.deploy("AccountFactory"); await this.deploy("SpotAcceptanceProbe"); await this.deploy("MockERC20");
    await this.call("TermbookCore", "setRecoveryKeeper", [this.actors.keeper, true]);
    await this.callbackSetup(words4);
  }
  protected async callbackSetup(words4: Hex[]) {
    const executionRouter = this.addresses.AtomicSpotRouter!;
    const callback = await this.deploy("SpotCallbackFixture");
    const router = await this.deploy("AtomicSpotRouter", [this.actors.borrower, callback, this.addresses.IntegrationRegistry]);
    this.addresses.CallbackRouter = router;
    this.addresses.AtomicSpotRouter = executionRouter;
    const bundle = word("callback bundle"), route = word("callback route");
    await this.call("IntegrationRegistry", "approve", [bundle, word("callback manifest")]);
    for (const target of [MARKET, USDC]) {
      const guard = this.addresses[`guard_${target}`] ?? this.addresses[`guard_${target.toLowerCase()}`];
      if (!guard) throw new Error("validation-callback-guard-required");
      await this.call("IntegrationRegistry", "pinDependency", [bundle, target]);
      await this.call("IntegrationRegistry", "setDependencyGuard", [bundle, target, guard]);
    }
    const buySelector = encodeFunctionData({ abi: parseAbi(["function placeAndExecuteMarketBuy(uint96,uint256,bool,bool)"]), functionName: "placeAndExecuteMarketBuy", args: [1n, 1n, false, true] }).slice(0, 10);
    await this.call("AtomicSpotRouter", "configure", [route, [bundle, MARKET, USDC, zero, buySelector, 0, 1, 100_000_000n, 1_000_000n, 1n, 2n ** 96n - 1n, words4]], this.actors.borrower, router);
    await this.call("SpotCallbackFixture", "configure", [router, USDC, bundle, route]);
    await this.transact({ to: USDC, from: this.actors.borrower, signature: "function transfer(address,uint256) returns(bool)", args: [callback, 100_000n] });
  }
  async facility(id: AcceptanceCaseId | string, collateral = 5_000n): Promise<Facility> {
    if (this.facilities.has(id)) return this.facilities.get(id)!;
    await this.refresh();
    const block = await this.chain.getBlock();
    const credit = word(`Kuru acceptance:${id}`), lock = word(`Kuru lock:${id}`), maturity = block.timestamp + 365n * 86400n;
    const deadline = block.timestamp + 86400n, borrower = this.actors.borrower, house = this.actors.keeper, intent = word(`Kuru intent:${id}`), terms = word("acceptance terms");
    const nonce = BigInt(credit);
    const digest = await this.read("TermbookCore", "quoteDigest", [intent, borrower, house, this.addresses.HouseVault, 10_000n, maturity, false, this.bundle, deadline, 0n, 0n, nonce, deadline, terms]);
    const signature_ = await this.keys[1]!.sign({ hash: digest });
    await this.call("TermbookCore", "accept", [credit, intent, borrower, house, this.addresses.HouseVault, 10_000n, maturity, false, this.bundle, deadline, 0n, terms, nonce, deadline, signature_]);
    await this.transact({ to: USDC, from: borrower, signature: "function approve(address,uint256) returns(bool)", args: [this.addresses.CollateralVault, collateral] });
    await this.call("TermbookCore", "setCollateral", [credit, this.addresses.CollateralVault, borrower]);
    await this.call("CollateralVault", "lock", [lock, credit, borrower, collateral, borrower]); await this.call("TermbookCore", "bindCollateral", [credit, lock]);
    await this.call("AccountFactory", "create", [credit, borrower, this.addresses.TermbookCore]);
    const account = await this.read("AccountFactory", "accountOf", [credit]);
    await this.call("TermbookCore", "bindAccount", [credit, account]);
    await this.call("TermbookCore", "configureRisk", [credit, 13_000n, 12_000n, 11_800n, 11_500n, 11_000n]); await this.call("TermbookCore", "recordHealth", [credit]);
    const facility = { id: credit, account, lock, maturity, collateral }; this.facilities.set(id, facility); return facility;
  }
  async execution(f: Facility, buying = true, amount = 10_000n, mutate?: (action: {
    capability: Hex; market: Hex; requiredInput: bigint; exposureLimit: bigint;
    calls: { target: Address; spendToken: Address; spendAmount: bigint; data: Hex; nativeValue: bigint }[];
  }, auth: { drawAmount: bigint; maxDraw: bigint; nonce: bigint; deadline: bigint; revision: bigint; signer: Address;
    signature: Hex; price: { roundId: bigint; referencePrice: bigint; updatedAt: bigint; authorizedAt: bigint; bound: bigint; slippageBps: number; isMax: boolean } }) => void) {
    const credit = await this.read("TermbookCore", "creditDetails", [f.id]);
    const [price, at, round] = await this.read("OracleRegistry", "read", [this.feedId]);
    const now = (await this.chain.getBlock({ blockTag: "finalized" })).timestamp;
    const bound = await this.read("PriceProtection", "deriveAmountBound", [price, amount, 0, buying ? 6 : 18, buying ? 18 : 6, buying, false]);
    const action = { capability: buying ? this.buy : this.sell, market: this.market, requiredInput: buying ? amount : 0n, exposureLimit: buying ? amount : 0n,
      calls: [{ target: this.addresses.AtomicSpotRouter!, spendToken: buying ? USDC : zero, spendAmount: buying ? amount : 0n,
        data: encodeFunctionData({ abi: parseAbi(["function trade(bytes32,uint256,uint256)"]), functionName: "trade", args: [buying ? this.buyRoute : this.sellRoute, amount, bound] }), nativeValue: buying ? 0n : amount }] };
    const auth = { drawAmount: buying ? amount : 0n, maxDraw: buying ? amount : 0n, nonce: credit.nonce + 1n, deadline: now + 60n,
      revision: credit.revision, signer: this.actors.borrower, signature: "0x" as Hex,
      price: { roundId: round, referencePrice: price, updatedAt: at, authorizedAt: now, bound, slippageBps: 0, isMax: false } };
    mutate?.(action, auth);
    const digest = await this.read("TermbookCore", "executionDigest", [f.id, action, auth]); auth.signature = await this.keys[0]!.sign({ hash: digest });
    return { to: this.addresses.TermbookCore!, from: this.actors.borrower, signature: await signature("TermbookCore", "executePlan"), args: [f.id, action, auth] } satisfies ValidationCall;
  }
}
