import { ReadProgramBuilder } from "../src/integration/read-program.js";
import { definition, addr, word } from "./plugin.fixture.js";
import { toFunctionSelector, type Hex } from "viem";

export function standardDefinition() {
  const d = definition();
  for (const n of ["8", "9", "a", "c"]) {
    d.pins.push({ target: addr(n), code_hash: d.pins[0]!.code_hash });
    d.verified_sources.push({ target: addr(n), source_hash: word("a") });
  }
  d.contracts = { execution: addr("4"), reader: addr("8"), recovery: addr("9"), exit: addr("9") };
  const constraints = [
    { kind: "spend" as const, exact: word("0"), minimum: "1", maximum: "1000000000" },
    { kind: "range" as const, exact: word("0"), minimum: "1", maximum: String(2n ** 256n - 1n) },
    { kind: "account" as const, exact: word("0"), minimum: "0", maximum: "0" },
  ];
  const p = new ReadProgramBuilder();
  const amount = p.amount(), zero = p.constant(0n);
  const query = p.query(addr("7"), "0x12345678");
  d.assessment = {
    read_program: addr("c"), state_target: addr("7"), reads: {},
    assets: [{ token: addr("5"), oracle: addr("a"), feed_id: word("b"), decimals: 18,
      maximum: "1000000000000000000000", dust: "1000", quote: { target: addr("7"), program: p.finish([amount, p.word(query, zero)]) } }],
    markets: [], retained_bps: 9000, recovery_costs: "0", max_positions: 2, max_pending: 0, max_requests: 0,
    action_limits: [{ action: "buy", maximum_input: "1000000000", maximum_exposure: "1000000000" }],
    calls: [{ target: addr("3"), selector: toFunctionSelector(d.actions[0]!.signature), recovery: false, native_maximum: "0", words: constraints },
      { target: addr("7"), selector: "0x12345678", recovery: true, native_maximum: "0", words: constraints }],
    recovery: [{ phase: "holding", market_id: addr("5"), target: addr("7"), selector: "0x12345678", input: addr("5"), output: addr("6"),
      spend_field: 1, minimum_field: 2, asynchronous: false, words: [
        { source: "field", value: `0x${"0".repeat(63)}1` as Hex }, { source: "minimum", value: word("0") }, { source: "account", value: word("0") }] }],
    prices: [{ action: "buy", market_id: d.markets[0]!.market_id, oracle: addr("a"), feed_id: word("b"), target: addr("3"),
      selector: toFunctionSelector(d.actions[0]!.signature), call_index: 0, price_decimals: 18, price_word: 1, direction_word: 0,
      maximum_direction: "0", minimum_direction: "1", max_slippage_bps: 100, max_deviation_bps: 500, max_authorization_age: 300,
      amount: { word: 0, input_decimals: 6, output_decimals: 18, inverse: true, max_input: false, input: addr("6"), output: addr("5") } }],
  };
  return d;
}
