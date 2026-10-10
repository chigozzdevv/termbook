import { describe, expect, it, vi } from "vitest";
import { atomicSpotModuleAbi, atomicSpotRouterAbi, readProgramAbi, integrationRegistryAbi,
  termbookCoreAbi, healthSourceAbi, appHealthReaderFactoryAbi } from "@termbook/bindings";
import { decodeFunctionData, encodeAbiParameters, keccak256, stringToHex, toFunctionSelector, zeroAddress, type Abi, type PublicClient } from "viem";
import { atomic_configuration, prepare_atomic_spot, verify_health_registry } from "../src/integration/atomic-spot.js";
import { definition, addr, word } from "./plugin.fixture.js";

function atomicDefinition() {
  const d = definition();
  for (const n of ["8", "9"]) {
    d.pins.push({ target: addr(n), code_hash: keccak256("0x1234") });
    d.verified_sources.push({ target: addr(n), source_hash: word("a") });
  }
  d.atomic_spot = { router: addr("3"), module: addr("4"), quote_source: addr("8"), oracle: addr("9"),
    feed_id: word("b"), quote_program: { queries: [{ target: addr("7"), data: "0x12345678", arguments: [], expected_hash: word("0"), gas_limit: 100000 }], steps: [{ op: 4, a: 0, b: 0, c: 0, value: "0" }, { op: 0, a: 0, b: 0, c: 0, value: "0" }, { op: 6, a: 1, b: 0, c: 0, value: "0" }], outputs: [0, 2] }, retained_bps: 9000, recovery_costs: "1000000",
    maximum_input: "100000000", max_holding: "1000000000000000000000", dust_limit: "1000", routes: (["buy", "sell"] as const).map((direction, i) => ({
      id: word(i ? "e" : "d"), target: addr("7"), input: addr(direction === "buy" ? "6" : "5"), output: addr(direction === "buy" ? "5" : "6"),
      selector: toFunctionSelector(direction === "buy" ? "buy(uint96,uint256,bool,bool)" : "sell(uint96,uint256,bool,bool)"),
      amount_word: 0, minimum_word: 1, numerator: "1", denominator: "1", minimum_size: "1", maximum_size: "1000000000",
      words: [word("0"), word("0"), word("0"), `0x${"0".repeat(63)}1`] })) };
  d.actions = (["buy", "sell"] as const).map((direction, i) => ({ ...d.actions[0]!, executionKey: direction,
    signature: "function trade(bytes32,uint256,uint256)", target: addr("3"), spendToken: addr(direction === "buy" ? "6" : "5"),
    fundingPath: direction === "buy" ? "amount.spend" : undefined,
    when: { market_id: "TOKEN-USDC", direction, order_type: "market", sizing: "spend" },
    arguments: [{ source: "constant", value: d.atomic_spot!.routes[i]!.id }, { source: "input", path: "amount.spend" }, { source: "price_bound" }] }));
  return d;
}
const options = () => ({ client: { getChainId: vi.fn(async () => 143),
  readContract: vi.fn(async ({ functionName }) => functionName === "core" ? addr("a") : functionName === "healthSource" ? addr("c") : addr("d")) } as unknown as PublicClient,
  registry: addr("b"), core: addr("a"), health_source: addr("c"), health_factory: addr("e"),
  maximum_spend: 100_000_000n, max_slippage_bps: 100, max_deviation_bps: 500, max_authorization_age: 300, max_health_age: 300 });

describe("atomic spot deployment plan", () => {
  it("binds readers on the registry behind an authenticated account health wrapper", async () => {
    const opts = options();
    const read = vi.mocked(opts.client.readContract);
    read.mockImplementation(async ({ functionName }) => ({ core: addr("a"), healthSource: addr("f"), source: addr("c"),
      governance: addr("b"), predict: addr("d") })[functionName as "core"] as never);
    const plan = await prepare_atomic_spot(atomicDefinition(), opts);
    expect(plan.calls.filter((call) => call.target === addr("c"))).toHaveLength(1);
    expect(plan.calls.some((call) => call.target === addr("f"))).toBe(false);
    read.mockImplementation(async ({ functionName }) => ({ core: addr("a"), healthSource: addr("f"), source: addr("e"),
      governance: addr("b"), predict: addr("d") })[functionName as "core"] as never);
    await expect(verify_health_registry(opts.client, opts.core, opts.health_source)).rejects.toThrow("integration-health-source-invalid");
    read.mockRejectedValue(new Error("Wrapper has no governance setter"));
    await expect(verify_health_registry(opts.client, opts.core, addr("f"))).rejects.toThrow("integration-health-source-invalid");
  });
  it("encodes every deployment call against the generated ABI and activates after health and recovery", async () => {
    const d = atomicDefinition();
    const result = await prepare_atomic_spot(d, options());
    const abis: Record<string, Abi> = { [addr("3")]: atomicSpotRouterAbi, [addr("4")]: atomicSpotModuleAbi,
      [addr("8")]: readProgramAbi, [addr("b")]: integrationRegistryAbi, [addr("a")]: termbookCoreAbi,
      [addr("c")]: healthSourceAbi, [addr("e")]: appHealthReaderFactoryAbi };
    const decoded = result.calls.map((call) => decodeFunctionData({ abi: abis[call.target.toLowerCase()]!, data: call.data }));
    expect(decoded.at(-1)?.functionName).toBe("activate");
    const recovery = decoded.findIndex((call) => call.functionName === "setAppRecoveryAdapter");
    const create = decoded.findIndex((call) => call.functionName === "create");
    const health = decoded.findIndex((call) => call.functionName === "setReader");
    expect(recovery).toBeLessThan(create); expect(create).toBeLessThan(health);
    const prices = decoded.filter((call) => call.functionName === "configureExecutionAmountPrice");
    expect(prices).toHaveLength(2);
    const config = atomic_configuration(d);
    const module = atomicSpotModuleAbi.find((entry) => entry.type === "function" && entry.name === "configure")!;
    expect(keccak256(encodeAbiParameters(module.inputs.slice(1), [d.settlement_asset, 9000, 1000000n, config.markets] as never)))
      .toBe(config.configuration_hash);
    const router = atomicSpotRouterAbi.find((entry) => entry.type === "function" && entry.name === "configure")!;
    expect(keccak256(encodeAbiParameters(router.inputs.slice(1), [config.routes[0]] as never))).toBe(config.route_hashes[0]);
    expect(config.markets[0]?.dustLimit).toBe(1000n);
    expect(config.markets[0]?.marketId).toBe(keccak256(stringToHex("TOKEN-USDC")));
    expect(result.calls.every((call) => call.value === 0n)).toBe(true);
  });
  it("requires an onchain guard for each proxy and a matching health factory", async () => {
    const d = atomicDefinition();
    d.pins[0] = { ...d.pins[0]!, implementation: addr("f"), implementation_code_hash: word("a"), implementation_slot: word("a") };
    d.verified_sources[0] = { ...d.verified_sources[0]!, implementation: addr("f"), implementation_source_hash: word("a") };
    await expect(prepare_atomic_spot(d, options())).rejects.toThrow("integration-dependency-guard-required");
    const plan = await prepare_atomic_spot(d, { ...options(), guards: { [addr("3")]: addr("f") } });
    expect(plan.calls.filter((call) => call.target.toLowerCase() === addr("b")).some((call) => decodeFunctionData({ abi: integrationRegistryAbi, data: call.data }).functionName === "setDependencyGuard"))
      .toBe(true);
    const wrong = options(); wrong.core = addr("f");
    await expect(prepare_atomic_spot(atomicDefinition(), wrong)).rejects.toThrow("integration-health-factory-invalid");
  });
  it("permits USDC buys and bounds native sells through the same router selector", async () => {
    const d = atomicDefinition(); d.markets[0]!.base_asset = zeroAddress;
    d.atomic_spot!.routes[0]!.output = zeroAddress; d.atomic_spot!.routes[1]!.input = zeroAddress;
    for (const action of d.actions) action.signature = "function trade(bytes32,uint256,uint256) payable";
    delete d.actions[1]!.spendToken; delete d.actions[1]!.spendPath; d.actions[1]!.valuePath = "amount.spend";
    const result = await prepare_atomic_spot(d, options());
    const policies = result.calls.filter((call) => call.target.toLowerCase() === addr("b"))
      .map((call) => decodeFunctionData({ abi: integrationRegistryAbi, data: call.data }))
      .filter((call) => call.functionName === "registerNativeValue");
    expect(policies.map((call) => call.args?.slice(3))).toEqual([
      [false, BigInt(d.atomic_spot!.max_holding), 255], [true, BigInt(d.atomic_spot!.max_holding), 1],
    ]);
  });
});
