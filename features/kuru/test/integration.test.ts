import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, keccak256, type PublicClient, type Address, type Hex } from "viem";
import { create_kuru } from "../integration.js";
const addr = (n: string) => `0x${n.repeat(40)}` as Address;
const word = (n: string) => `0x${n.repeat(64)}` as Hex;
const params = [10000, 100000000n, addr("5"), 18n, addr("6"), 6n, 1, 1n, 2n ** 96n - 1n, 30n, 0n] as const;
let read: ReturnType<typeof vi.fn>;
function client() {
  return { getChainId: vi.fn(async () => 143), getBlock: vi.fn(async () => ({ number: 1n, hash: word("a") })),
    readContract: read, getBytecode: vi.fn(async () => "0x1234"), getStorageAt: vi.fn(async () => word("0")), getBalance: vi.fn(async () => 10n ** 18n) } as unknown as PublicClient;
}
const options = () => ({ client: client(), market_address: addr("7"), settlement_asset: addr("6"), api_base: "https://api.termbook.org",
  maximum_input: 1000_000_000n, retained_bps: 9500, recovery_costs: 10n, max_holding: 1000n * 10n ** 18n, dust_limit: 1_000_000_000_000n, oracle: addr("9"), feed_id: word("b") });
beforeEach(() => {
  read = vi.fn(async ({ functionName }) => functionName === "getMarketParams" ? params : functionName === "isTrustedForwarder" ? false : 10n ** 18n);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("platform")
    ? { chain_id: 143, router: addr("3"), module: addr("4"), read_program: addr("8") }
    : { target: new URL(url).searchParams.get("target"), code_hash: keccak256("0x1234"), source_hash: word("c") }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());
describe("Kuru spot package", () => {
  it("builds buy and sell calls with raw units and the bound Credit Account recipient", async () => {
    const plugin = await create_kuru(options());
    const context = { client: client(), credit_id: word("d"), account: addr("2"), borrower: addr("1"),
      block: { number: 1n, hash: word("a") }, market: plugin.markets[0]!, minimum_receive: 1n };
    for (const direction of ["buy", "sell"] as const) {
      const amount = direction === "buy" ? 100000000n : 10n ** 18n;
      const plan = await plugin.actions.place_order.build({ ...context, action: { use_case: "spot", capability: "place_order",
        params: { market_id: addr("7"), direction, order_type: "market", amount: { spend: amount }, slippage_bps: 50 } } });
      const decoded = decodeFunctionData({ abi: parseAbi(["function trade(bytes32,uint256,uint256) payable returns (uint256)"]), data: plan.calls[0]!.data as `0x${string}` });
      expect(decoded.args?.[1]).toBe(amount);
      expect(plan.receiving[0]!.controlled_by).toBe(context.account);
      expect(plugin.definition.actions.find((a) => a.when?.direction === direction)?.fundingPath).toBe(direction === "buy" ? "amount.spend" : undefined);
    }
  });
  it("reads balances at one block and builds a sell step for remaining holdings", async () => {
    const plugin = await create_kuru(options());
    const context = { client: client(), credit_id: word("d"), account: addr("2"), block: { number: 1n, hash: word("a") } };
    const state = await plugin.account.read(context);
    expect(state.orders).toEqual([]);
    expect(state.holdings).toHaveLength(2);
    const result = await plugin.exit.next({ ...context, state, slippage_bps: 50, minimum_receive: async () => 1n });
    expect(result.status).toBe("execute");
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ functionName: "balanceOf", blockNumber: 1n, args: [context.account] }));
  });
  it("rejects unsupported quote assets and unsafe forwarding", async () => {
    await expect(create_kuru({ ...options(), settlement_asset: addr("a") })).rejects.toThrow("integration-kuru-market-unsupported");
    read.mockImplementation(async ({ functionName }) => functionName === "getMarketParams" ? params : true);
    await expect(create_kuru(options())).rejects.toThrow("integration-forwarder-unsafe");
  });
});
