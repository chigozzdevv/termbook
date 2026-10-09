import { keccak256, stringToHex, type Address, type Hex } from "viem";
import type { PluginDefinition } from "@termbook/schema";
import { standardDefinition } from "./use-case.fixture.js";
import type { spot } from "../src/integration/plugin.js";
export const addr = (n: string) => `0x${n.repeat(40)}` as Address;
export const word = (n: string) => `0x${n.repeat(64)}` as Hex;
export function definition(): PluginDefinition {
  const market = { market_id: "TOKEN-USDC", address: addr("7"), base_asset: addr("5"), quote_asset: addr("6"), base_decimals: 18, quote_decimals: 6 };
  return { format: 1, name: "Test spot", use_case: "spot", chain_id: 143, settlement_asset: addr("6"), markets: [market],
    contracts: { execution: addr("4"), reader: addr("4"), recovery: addr("4"), exit: addr("4") },
    pins: ["3", "4", "5", "6", "7"].map((n) => ({ target: addr(n), code_hash: keccak256("0x1234") })),
    verified_sources: ["3", "4", "5", "6", "7"].map((n) => ({ target: addr(n), source_hash: word("a") })),
    actions: [{ capability: "place_order", executionKey: "buy", label: "Buy", settlement: "atomic", target: addr("3"),
      signature: "function buy(uint256 amount,uint256 minimum,address recipient)",
      arguments: [{ source: "input", path: "amount.spend" }, { source: "price_bound" }, { source: "credit_account" }],
      when: { market_id: market.market_id, direction: "buy", order_type: "market", sizing: "spend" },
      fundingPath: "amount.spend", spendPath: "amount.spend", spendToken: addr("6"), marketPath: "market_id",
      price: { kind: "min_output", amountPath: "amount.spend", slippagePath: "slippage_bps", markets: [keccak256(stringToHex(market.market_id))] } }],
  };
}
export function testPlugin(): spot {
  const d = standardDefinition();
  return { name: d.name, use_case: "spot", chain_id: d.chain_id, markets: d.markets, definition: d,
    account: { async read(context) { return { block: context.block, holdings: [], orders: [], liabilities: [] }; } },
    actions: { place_order: { async build() { throw new Error("fixture-only"); } } },
    exit: { async next() { return { status: "done" }; } } };
}
