import { pluginDefinitionSchema, canonicalEvidence, executionKey, type PluginDefinition } from "@termbook/schema";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, stringToHex,
  toFunctionSelector, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { compile_read_program, readProgramAbi } from "./read-program.js";

const routeTuple = "(bytes32 bundle,address target,address input,address output,bytes4 selector,uint8 amountWord,uint8 minimumWord,uint256 numerator,uint256 denominator,uint256 minimumSize,uint256 maximumSize,bytes32[] words)";
const marketTuple = "(bytes32 marketId,bytes32 buyRoute,bytes32 sellRoute,address quoteSource,uint256 maxHolding,address oracle,bytes32 feedId,uint8 baseDecimals,uint8 quoteDecimals,bytes32 buyCapability,bytes32 sellCapability,uint256 dustLimit,bytes32 quoteProgram,uint128 maximumInput)";
export const atomicSpotAbi = parseAbi([
  `function configure(bytes32 id,${routeTuple} value)`,
  `function configure(bytes32 bundle,address settlement,uint16 retainedBps,uint128 costs,${marketTuple}[] markets)`,
  "function routeHashes(bytes32) view returns (bytes32)",
  "function configurationHashes(bytes32) view returns (bytes32)",
]);
export const registryAbi = parseAbi([
  "function approve(bytes32 id,bytes32 codeHash)",
  "function pinDependency(bytes32 id,address dependency)",
  "function setDependencyGuard(bytes32 id,address dependency,address guard)",
  "function registerCall(bytes32 id,address target,bytes4 selector,uint256 maxDataLength,uint8 recipientArg,uint8 amountArg,uint256 maxAmount)",
  "function setCallValidator(bytes32 id,address target,bytes4 selector,address validator)",
  "function registerRecoveryCall(bytes32 id,address target,bytes4 selector,uint256 maxDataLength,uint8 recipientArg)",
  "function setRecoveryCallValidator(bytes32 id,address target,bytes4 selector,address validator)",
  "function registerNativeValue(bytes32 id,address target,bytes4 selector,bool recovery,uint256 maxValue,uint8 amountArg)",
  "function activate(bytes32 id)",
]);
const ruleTuple = "(address oracle,bytes32 feedId,address target,bytes4 selector,uint8 callIndex,uint8 priceDecimals,uint16 priceWord,uint16 directionWord,uint16 maxSlippageBps,uint16 maxDeviationBps,uint32 maxAuthorizationAge,uint256 maximumDirection,uint256 minimumDirection)";
const amountTuple = "(uint16 amountWord,uint8 inputDecimals,uint8 outputDecimals,bool inverse,bool maxInput,bool active,address inputAsset,address outputAsset)";
export const coreAbi = parseAbi([
  "function configureExecutionPolicy(bytes32,address,uint8,uint8,uint32)",
  "function setAppRecoveryAdapter(bytes32,address)", "function setExitPlanner(bytes32,address)", "function setExitVerifier(bytes32,address)",
  `function configureExecutionAmountPrice(bytes32,bytes32,bytes32,${ruleTuple},${amountTuple})`,
]);
export const healthAbi = parseAbi(["function setReader(bytes32,address,uint256,uint256)"]);
export const factoryAbi = parseAbi(["function core() view returns (address)", "function predict(bytes32,address,address) view returns (address)",
  "function create(bytes32,address,address) returns (address)"]);

export function atomic_configuration(input: PluginDefinition) {
  const definition = pluginDefinitionSchema.parse(input);
  const config = definition.atomic_spot;
  if (!config) throw new Error("integration-spot-definition-required");
  if (definition.actions.some((a) => toFunctionSelector(parseAbi([a.signature])[0]!) !== toFunctionSelector("trade(bytes32,uint256,uint256)"))) {
    throw new Error("integration-spot-action-invalid");
  }
  const hash = keccak256(stringToHex(canonicalEvidence(definition)));
  const version_id = keccak256(stringToHex(`termbook.integration.v1:${definition.chain_id}:${hash}`));
  const routes = config.routes.map((r) => ({ bundle: version_id, target: r.target as Address, input: r.input as Address, output: r.output as Address,
    selector: r.selector as Hex, amountWord: r.amount_word, minimumWord: r.minimum_word, numerator: BigInt(r.numerator), denominator: BigInt(r.denominator),
    minimumSize: BigInt(r.minimum_size), maximumSize: BigInt(r.maximum_size), words: r.words as Hex[] }));
  const market = definition.markets[0]!;
  const quote_program = compile_read_program(config.quote_program);
  const buyIndex = routes.findIndex((r) => r.input.toLowerCase() === definition.settlement_asset.toLowerCase());
  const sellIndex = routes.findIndex((r) => r.output.toLowerCase() === definition.settlement_asset.toLowerCase());
  if (buyIndex < 0 || sellIndex < 0 || buyIndex === sellIndex
    || routes[buyIndex]!.output.toLowerCase() !== market.base_asset.toLowerCase()
    || routes[sellIndex]!.input.toLowerCase() !== market.base_asset.toLowerCase()) throw new Error("integration-spot-route-invalid");
  const markets = [{ marketId: keccak256(stringToHex(market.market_id)), buyRoute: config.routes[buyIndex]!.id as Hex,
    sellRoute: config.routes[sellIndex]!.id as Hex, quoteSource: config.quote_source as Address,
    maxHolding: BigInt(config.max_holding), oracle: config.oracle as Address, feedId: config.feed_id as Hex,
    baseDecimals: market.base_decimals, quoteDecimals: market.quote_decimals,
    buyCapability: keccak256(stringToHex(executionKey(definition.actions.find((a) => a.when?.direction === "buy")!))),
    sellCapability: keccak256(stringToHex(executionKey(definition.actions.find((a) => a.when?.direction === "sell")!))), dustLimit: BigInt(config.dust_limit),
    quoteProgram: quote_program.id, maximumInput: BigInt(config.maximum_input) }];
  const route_hashes = routes.map((r) => keccak256(encodeAbiParameters(parseAbi([`function route(${routeTuple})`])[0].inputs, [r])));
  const configuration_hash = keccak256(encodeAbiParameters(parseAbi([`function configuration(address,uint16,uint128,${marketTuple}[])`])[0].inputs,
    [definition.settlement_asset as Address, config.retained_bps, BigInt(config.recovery_costs), markets]));
  return { definition, config, hash, version_id, routes, markets, route_hashes, configuration_hash, quote_program };
}

export type GovernanceCall = { target: Address; data: Hex; value: bigint; description: string };
export async function prepare_atomic_spot(input: PluginDefinition, options: {
  client: PublicClient; registry: Address; core: Address; health_source: Address; health_factory: Address;
  guards?: Record<string, Address>;
  max_slippage_bps: number; max_deviation_bps: number; max_authorization_age: number; max_health_age: number;
}): Promise<{ version_id: Hex; health_reader: Address; calls: GovernanceCall[] }> {
  const { definition, config, hash, version_id, routes, markets, quote_program } = atomic_configuration(input);
  if (![options.max_slippage_bps, options.max_deviation_bps, options.max_authorization_age, options.max_health_age].every(Number.isSafeInteger)
    || options.max_slippage_bps < 0 || options.max_slippage_bps > 5000 || options.max_deviation_bps < 1 || options.max_deviation_bps > 5000
    || options.max_authorization_age < 1 || options.max_authorization_age > 900 || options.max_health_age < 1
    || options.max_health_age > 900) throw new Error("integration-risk-limits-invalid");
  const calls: GovernanceCall[] = [];
  if (await options.client.getChainId() !== definition.chain_id
    || (await options.client.readContract({ address: options.health_factory, abi: factoryAbi, functionName: "core", blockTag: "finalized" })).toLowerCase()
      !== options.core.toLowerCase()) throw new Error("integration-health-factory-invalid");
  const health_reader = await options.client.readContract({ address: options.health_factory, abi: factoryAbi, functionName: "predict",
    args: [version_id, config.module as Address, config.module as Address], blockTag: "finalized" });
  const push = (target: Address, abi: readonly unknown[], name: string, args: readonly unknown[], description: string) => {
    calls.push({ target, data: encodeFunctionData({ abi, functionName: name, args } as never), value: 0n, description });
  };
  push(options.registry, registryAbi, "approve", [version_id, hash], "Approve the integration definition");
  for (const pin of definition.pins) {
    push(options.registry, registryAbi, "pinDependency", [version_id, pin.target], "Pin a dependency");
    const guard = options.guards?.[pin.target.toLowerCase()];
    if (pin.implementation && !guard) throw new Error("integration-dependency-guard-required");
    if (guard) push(options.registry, registryAbi, "setDependencyGuard", [version_id, pin.target, guard], "Bind the dependency guard");
  }
  routes.forEach((route, i) => push(config.router as Address, atomicSpotAbi, "configure", [config.routes[i]!.id, route], "Configure an immutable spot route"));
  push(config.quote_source as Address, readProgramAbi, "configure", [quote_program.id, quote_program.program], "Register verified read instructions");
  push(config.module as Address, atomicSpotAbi, "configure", [version_id, definition.settlement_asset,
    config.retained_bps, BigInt(config.recovery_costs), markets], "Configure spot accounting and recovery");
  const ceiling = BigInt(config.maximum_input) > BigInt(config.max_holding) ? BigInt(config.maximum_input) : BigInt(config.max_holding);
  const trade = toFunctionSelector("trade(bytes32,uint256,uint256)");
  push(options.registry, registryAbi, "registerCall", [version_id, config.router, trade, 100n, 255, 1, ceiling], "Allow bounded spot trades");
  push(options.registry, registryAbi, "setCallValidator", [version_id, config.router, trade, config.module], "Verify spot arguments");
  push(options.registry, registryAbi, "registerRecoveryCall", [version_id, config.router, trade, 100n, 255], "Allow recovery sales");
  push(options.registry, registryAbi, "setRecoveryCallValidator", [version_id, config.router, trade, config.module], "Verify recovery arguments");
  const base = definition.markets[0]!.base_asset;
  if (base !== zeroAddress) {
    const approve = toFunctionSelector("approve(address,uint256)");
    push(options.registry, registryAbi, "registerRecoveryCall", [version_id, base, approve, 68n, 255], "Allow bounded recovery approvals");
    push(options.registry, registryAbi, "setRecoveryCallValidator", [version_id, base, approve, config.module], "Verify recovery approval ownership");
  } else {
    // The shared selector also handles ERC-20 buys with zero native value.
    push(options.registry, registryAbi, "registerNativeValue", [version_id, config.router, trade, false, BigInt(config.max_holding), 255], "Bound native spot spending");
    push(options.registry, registryAbi, "registerNativeValue", [version_id, config.router, trade, true, BigInt(config.max_holding), 1], "Bound native recovery spending");
  }
  push(options.core, coreAbi, "configureExecutionPolicy", [version_id, config.module, 1, 0, options.max_health_age], "Configure spot execution and state checks");
  push(options.core, coreAbi, "setAppRecoveryAdapter", [version_id, config.module], "Bind recovery");
  push(options.core, coreAbi, "setExitPlanner", [version_id, config.module], "Bind closure planning");
  push(options.core, coreAbi, "setExitVerifier", [version_id, config.module], "Bind exit verification");
  const market = definition.markets[0]!;
  for (const [index, direction] of (["buy", "sell"] as const).entries()) {
    const buying = direction === "buy";
    const action = definition.actions.find((a) => a.when?.direction === direction)!;
    const rule = { oracle: config.oracle, feedId: config.feed_id, target: config.router, selector: trade, callIndex: 0,
      priceDecimals: buying ? market.base_decimals : market.quote_decimals, priceWord: 2, directionWord: 0,
      maxSlippageBps: options.max_slippage_bps, maxDeviationBps: options.max_deviation_bps,
      maxAuthorizationAge: options.max_authorization_age, maximumDirection: 0n, minimumDirection: 1n };
    const route = routes.find((r) => (buying ? r.input : r.output).toLowerCase() === definition.settlement_asset.toLowerCase())!;
    const amount = { amountWord: 1, inputDecimals: buying ? market.quote_decimals : market.base_decimals,
      outputDecimals: buying ? market.base_decimals : market.quote_decimals, inverse: buying, maxInput: false,
      active: true, inputAsset: route.input, outputAsset: route.output };
    push(options.core, coreAbi, "configureExecutionAmountPrice", [version_id, index === 0 ? markets[0]!.buyCapability : markets[0]!.sellCapability,
      markets[0]!.marketId, rule, amount], `Configure ${action.label} amount and price checks`);
  }
  push(options.health_factory, factoryAbi, "create", [version_id, config.module, config.module], "Create the bound health reader");
  push(options.health_source, healthAbi, "setReader", [version_id, health_reader, 1n, BigInt(options.max_health_age)], "Bind authoritative health accounting");
  push(options.registry, registryAbi, "activate", [version_id], "Activate the configured integration");
  return { version_id, health_reader, calls };
}
