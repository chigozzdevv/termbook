import { pluginDefinitionSchema, canonicalEvidence, executionKey, capabilityCalls, type PluginDefinition } from "@termbook/schema";
import { spotOrderTrackerAbi, useCaseReaderAbi, useCasePolicyAbi, useCaseRecoveryAbi, termbookCoreAbi } from "@termbook/bindings";
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256, stringToHex, toFunctionSelector, zeroAddress,
  type Address, type Hex, type PublicClient, type Abi } from "viem";
import { compile_read_program, readProgramAbi } from "./read-program.js";
import { atomicSpotAbi, registryAbi, healthAbi, factoryAbi, verify_health_registry, type GovernanceCall } from "./atomic-spot.js";

const zero = `0x${"0".repeat(64)}` as Hex;
const cases = ["spot", "perps", "vault", "staking", "liquidity"];
const phases = ["pending", "request", "position", "holding", "custody"];
const sources = ["literal", "account", "credit", "field", "minimum"];
const kinds = ["exact", "account", "range", "spend", "credit"];
const marketId = (id: string) => id ? keccak256(stringToHex(id)) : zero;
function configHash(abi: Abi, args: readonly unknown[]): Hex {
  const fn = abi.find((e) => e.type === "function" && e.name === "configure");
  if (!fn || fn.type !== "function") throw new Error("integration-configuration-invalid");
  return keccak256(encodeAbiParameters(fn.inputs.slice(1), args as never));
}

export function use_case_configuration(input: PluginDefinition) {
  const definition = pluginDefinitionSchema.parse(input), a = definition.assessment;
  if (!a) throw new Error("integration-assessment-required");
  const hash = keccak256(stringToHex(canonicalEvidence(definition)));
  const version_id = keccak256(stringToHex(`termbook.integration.v1:${definition.chain_id}:${hash}`));
  const routes = (a.routes?.values ?? []).map((r) => ({ bundle: version_id, target: r.target as Address, input: r.input as Address,
    output: r.output as Address, selector: r.selector as Hex, amountWord: r.amount_word, minimumWord: r.minimum_word,
    numerator: BigInt(r.numerator), denominator: BigInt(r.denominator), minimumSize: BigInt(r.minimum_size),
    maximumSize: BigInt(r.maximum_size), words: r.words as Hex[] }));
  const route_hashes = routes.map((r) => configHash(atomicSpotAbi, [r]));
  const programs = new Map<Hex, ReturnType<typeof compile_read_program>>();
  const compile = (program: Parameters<typeof compile_read_program>[0] | undefined) => {
    if (!program) return zero;
    const result = compile_read_program(program); programs.set(result.id, result); return result.id;
  };
  const emptyAsset = { token: zeroAddress, oracle: zeroAddress, feed: zero, decimals: 0, maximum: 0n, dust: 0n, quoteProgram: zero, quoteTarget: zeroAddress };
  const asset = (v: typeof a.assets[number]) => ({ token: v.token as Address, oracle: v.oracle as Address, feed: v.feed_id as Hex,
    decimals: v.decimals, maximum: BigInt(v.maximum), dust: BigInt(v.dust), quoteProgram: compile(v.quote?.program),
    quoteTarget: v.quote?.target as Address ?? zeroAddress });
  const orders = a.orders?.rules.map((r) => ({ id: r.id as Hex, market: marketId(r.market_id), target: r.target as Address,
    input: r.input as Address, custody: r.custody as Address, counterProgram: compile(r.counter), stateProgram: compile(r.state),
    balanceProgram: compile(r.balance), maximumInput: BigInt(r.maximum_input), maximumQuantity: BigInt(r.maximum_quantity), buy: r.buy })) ?? [];
  const reader = { useCase: cases.indexOf(definition.use_case), settlement: definition.settlement_asset as Address,
    stateTarget: a.state_target as Address, metaProgram: compile(a.reads.meta), positionProgram: compile(a.reads.position),
    pendingProgram: compile(a.reads.pending), requestProgram: compile(a.reads.request), reconcileProgram: compile(a.reads.reconcile),
    retainedBps: a.retained_bps, recoveryCosts: BigInt(a.recovery_costs), maxPositions: a.max_positions,
    maxPending: a.max_pending, maxRequests: a.max_requests, orderTracker: a.orders?.tracker as Address ?? zeroAddress,
    custody: (a.custody ?? []).map((c) => ({ target: c.target as Address, program: compile(c.program), token: c.token as Address,
      maximum: BigInt(c.maximum), dust: BigInt(c.dust) })), assets: a.assets.map(asset),
    markets: a.markets.map((m) => ({ id: marketId(m.market_id), receipt: m.receipt as Address,
      asset0: asset(m.asset0), asset1: m.asset1 ? asset(m.asset1) : emptyAsset, maximumExposure: BigInt(m.maximum_exposure) })) };
  const actions = definition.actions.map((action) => {
    const limit = a.action_limits.find((l) => l.action === executionKey(action))!;
    return { id: keccak256(stringToHex(executionKey(action))), market: marketId(action.when?.market_id ?? ""),
      operation: keccak256(stringToHex(action.capability)), maximumInput: BigInt(limit.maximum_input),
      maximumExposure: BigInt(limit.maximum_exposure), asynchronous: action.settlement === "asynchronous", calls: capabilityCalls(action).map((call) => {
        const configured = a.calls.find((c) => c.target.toLowerCase() === call.target.toLowerCase() && c.selector === toFunctionSelector(call.signature));
        if (!configured) throw new Error("integration-action-rule-missing");
        const fn = (parseAbi([call.signature]) as Abi).find((entry) => entry.type === "function");
        if (!fn || fn.type !== "function") throw new Error("integration-action-layout-unsupported");
        const singleton = fn.inputs.length === 1 && /^uint(?:[0-9]+)?\[\]$/.test(fn.inputs[0]!.type)
          && call.arguments[0]?.singleton === true;
        if (singleton ? configured.words.length !== 3 : fn.inputs.length !== configured.words.length
          || fn.inputs.some((i) => !/^(address|bool|u?int(?:[0-9]+)?|bytes(?:[0-9]+))$/.test(i.type))) throw new Error("integration-action-layout-unsupported");
        const words = configured.words.map((w, index) => {
          if (singleton && index < 2) return { kind: 0, exact: `0x${BigInt(index === 0 ? 32 : 1).toString(16).padStart(64, "0")}` as Hex, minimum: 0n, maximum: 0n };
          const argument = call.arguments[singleton ? 0 : index];
          if (!argument || !singleton && argument.singleton) throw new Error("integration-action-rule-missing");
          if (argument.source === "constant") return { kind: 0, exact: encodeAbiParameters([fn.inputs[index]!], [argument.value] as never), minimum: 0n, maximum: 0n };
          if (argument.source === "credit_id") return { kind: 4, exact: zero, minimum: 0n, maximum: 0n };
          if (argument.source === "borrower") throw new Error("integration-borrower-custody-unsupported");
          if (argument.source === "credit_account") return { kind: 1, exact: zero, minimum: 0n, maximum: 0n };
          return { kind: kinds.indexOf(w.kind), exact: w.exact as Hex, minimum: BigInt(w.minimum), maximum: BigInt(w.maximum) };
        });
        const native = call.valuePath || call.valueFromBound || call.nativeValue !== undefined;
        const nativeWord = call.valuePath ? call.arguments.findIndex((a) => a.source === "input" && a.path === call.valuePath)
          : call.valueFromBound ? call.arguments.findIndex((a) => a.source === "price_bound") : -1;
        if (native && (nativeWord < 0 || singleton || BigInt(configured.native_maximum) === 0n)) throw new Error("integration-native-budget-required");
        return { target: configured.target as Address, selector: configured.selector as Hex, recovery: false, words,
          maximumNative: native ? BigInt(configured.native_maximum) : 0n, nativeWord: native ? nativeWord : 255 };
      }) };
  });
  const calls = a.calls.map((call) => ({ target: call.target as Address, selector: call.selector as Hex, recovery: call.recovery, maximumNative: BigInt(call.native_maximum), nativeWord: call.native_word ?? 255,
    words: call.words.map((w) => ({ kind: kinds.indexOf(w.kind), exact: w.exact as Hex, minimum: BigInt(w.minimum), maximum: BigInt(w.maximum) })) }));
  for (const action of definition.actions) for (const call of capabilityCalls(action)) {
    if (!calls.some((c) => c.target.toLowerCase() === call.target.toLowerCase()
      && c.selector === toFunctionSelector(call.signature))) throw new Error("integration-action-rule-missing");
  }
  const recovery = a.recovery.map((r) => ({ phase: phases.indexOf(r.phase),
    market: ["holding", "custody"].includes(r.phase) && /^0x[a-fA-F0-9]{40}$/.test(r.market_id)
      ? `0x${r.market_id.slice(2).padStart(64, "0")}` as Hex : marketId(r.market_id), target: r.target as Address,
    selector: r.selector as Hex, words: r.words.map((w) => ({ source: sources.indexOf(w.source), value: w.value as Hex })),
    input: r.input as Address, output: r.output as Address, spendField: r.spend_field ?? 255,
    minimumField: r.minimum_field ?? 255, asynchronous: r.asynchronous, pendingStatus: r.pending_status ?? 0 }));
  const prices = a.prices.map((p) => ({ capability: keccak256(stringToHex(p.action)), market: marketId(p.market_id),
    rule: { oracle: p.oracle as Address, feedId: p.feed_id as Hex, target: p.target as Address, selector: p.selector as Hex,
      callIndex: p.call_index, priceDecimals: p.price_decimals, priceWord: p.price_word, directionWord: p.direction_word,
      maxSlippageBps: p.max_slippage_bps, maxDeviationBps: p.max_deviation_bps, maxAuthorizationAge: p.max_authorization_age,
      maximumDirection: BigInt(p.maximum_direction), minimumDirection: BigInt(p.minimum_direction) },
    amount: p.amount ? { amountWord: p.amount.word, inputDecimals: p.amount.input_decimals, outputDecimals: p.amount.output_decimals,
      inverse: p.amount.inverse, maxInput: p.amount.max_input, active: true, inputAsset: p.amount.input as Address, outputAsset: p.amount.output as Address } : undefined }));
  return { definition, assessment: a, hash, version_id, routes, route_hashes, programs: [...programs.values()], orders, order_hash: orders.length ? configHash(spotOrderTrackerAbi, [orders]) : zero, reader, actions, calls, recovery, prices,
    reader_hash: configHash(useCaseReaderAbi, [reader]), policy_hash: configHash(useCasePolicyAbi, [actions, calls]),
    recovery_hash: configHash(useCaseRecoveryAbi, [recovery]) };
}

export async function prepare_use_case(input: PluginDefinition, options: {
  client: PublicClient; registry: Address; core: Address; health_source: Address; health_factory: Address;
  guards?: Record<string, Address>; max_health_age: number;
}): Promise<{ version_id: Hex; health_reader: Address; calls: GovernanceCall[] }> {
  const c = use_case_configuration(input);
  if (!Number.isSafeInteger(options.max_health_age) || options.max_health_age < 1 || options.max_health_age > 900
    || await options.client.getChainId() !== c.definition.chain_id) throw new Error("integration-risk-limits-invalid");
  if ((await options.client.readContract({ address: options.health_factory, abi: factoryAbi, functionName: "core", blockTag: "finalized" })).toLowerCase()
    !== options.core.toLowerCase()) throw new Error("integration-health-factory-invalid");
  await verify_health_registry(options.client, options.core, options.health_source);
  const targets = c.definition.contracts;
  const health_reader = await options.client.readContract({ address: options.health_factory, abi: factoryAbi, functionName: "predict",
    args: [c.version_id, targets.reader as Address, targets.recovery as Address], blockTag: "finalized" });
  const calls: GovernanceCall[] = [];
  const push = (target: Address, abi: Abi, name: string, args: readonly unknown[], description: string) => {
    calls.push({ target, data: encodeFunctionData({ abi, functionName: name, args } as never), value: 0n, description });
  };
  push(options.registry, registryAbi, "approve", [c.version_id, c.hash], "Approve the immutable definition");
  for (const pin of c.definition.pins) {
    push(options.registry, registryAbi, "pinDependency", [c.version_id, pin.target], "Pin a dependency");
    const guard = options.guards?.[pin.target.toLowerCase()];
    if (pin.implementation && !guard) throw new Error("integration-dependency-guard-required");
    if (guard) push(options.registry, registryAbi, "setDependencyGuard", [c.version_id, pin.target, guard], "Bind the reviewed guard");
  }
  c.routes.forEach((route, i) => push(c.assessment.routes!.router as Address, atomicSpotAbi, "configure",
    [c.assessment.routes!.values[i]!.id, route], "Configure bounded spot execution"));
  for (const p of c.programs) push(c.assessment.read_program as Address, readProgramAbi, "configure", [p.id, p.program], "Register immutable reads");
  if (c.assessment.orders) push(c.assessment.orders.tracker as Address, spotOrderTrackerAbi, "configure", [c.version_id, c.orders], "Configure bounded order tracking");
  push(targets.reader as Address, useCaseReaderAbi, "configure", [c.version_id, c.reader], "Configure standard accounting");
  push(targets.execution as Address, useCasePolicyAbi, "configure", [c.version_id, c.actions, c.calls], "Configure standard action checks");
  push(targets.recovery as Address, useCaseRecoveryAbi, "configure", [c.version_id, c.recovery], "Configure standard recovery checks");
  for (const rule of c.assessment.calls) {
    const recipient = rule.words.findIndex((w) => w.kind === "account");
    const amount = rule.words.findIndex((w) => w.kind === "spend");
    const max = amount === -1 ? 0n : BigInt(rule.words[amount]!.maximum);
    push(options.registry, registryAbi, "registerCall", [c.version_id, rule.target, rule.selector, BigInt(4 + 32 * rule.words.length),
      recipient === -1 ? 255 : recipient, amount === -1 ? 255 : amount, max], "Register bounded calls");
    push(options.registry, registryAbi, "setCallValidator", [c.version_id, rule.target, rule.selector, targets.execution], "Verify call arguments");
    if (rule.recovery) {
      push(options.registry, registryAbi, "registerRecoveryCall", [c.version_id, rule.target, rule.selector,
        BigInt(4 + 32 * rule.words.length), recipient === -1 ? 255 : recipient], "Register recovery calls");
      push(options.registry, registryAbi, "setRecoveryCallValidator", [c.version_id, rule.target, rule.selector, targets.execution], "Verify recovery arguments");
    }
    if (BigInt(rule.native_maximum) > 0n) {
      if (rule.native_word === undefined) throw new Error("integration-native-budget-required");
      push(options.registry, registryAbi, "registerNativeValue", [c.version_id, rule.target, rule.selector, false, BigInt(rule.native_maximum), rule.native_word], "Bound native spending");
      if (rule.recovery) push(options.registry, registryAbi, "registerNativeValue", [c.version_id, rule.target, rule.selector, true, BigInt(rule.native_maximum), rule.native_word], "Bound native recovery");
    }
  }
  push(options.core, termbookCoreAbi, "configureExecutionPolicy", [c.version_id, targets.execution, c.reader.maxPositions, c.reader.maxPending, options.max_health_age], "Bind execution and state");
  push(options.core, termbookCoreAbi, "setAppRecoveryAdapter", [c.version_id, targets.recovery], "Bind recovery");
  push(options.core, termbookCoreAbi, "setExitPlanner", [c.version_id, targets.recovery], "Bind closure planning");
  push(options.core, termbookCoreAbi, "setExitVerifier", [c.version_id, targets.exit], "Bind exit verification");
  for (const price of c.prices) push(options.core, termbookCoreAbi, price.amount ? "configureExecutionAmountPrice" : "configureExecutionPrice",
    [c.version_id, price.capability, price.market, price.rule, ...(price.amount ? [price.amount] : [])], "Bind independent price protection");
  push(options.health_factory, factoryAbi, "create", [c.version_id, targets.reader, targets.recovery], "Create bound health accounting");
  push(options.health_source, healthAbi, "setReader", [c.version_id, health_reader, 1n, BigInt(options.max_health_age)], "Bind authoritative health");
  push(options.registry, registryAbi, "activate", [c.version_id], "Activate after configuration");
  return { version_id: c.version_id, health_reader, calls };
}
