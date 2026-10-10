import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, keccak256, zeroAddress, type PublicClient, type Address, type Hex } from "viem";
import { create_kuru, KuruSourceUnavailableError } from "../integration.js";
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
function nativeRead(functionName: string, args?: string[]) {
  if (functionName === "getMarketParams") return params;
  if (functionName === "isTrustedForwarder") return args?.[0] === addr("d");
  return ({ kuruAmmVault: addr("a"), owner: addr("b"), market: addr("7"), marginAccount: addr("c"),
    marginAccountAddress: addr("c"), TRUSTED_FORWARDER: addr("d") })[functionName as "owner"] ?? 10n ** 18n;
}
beforeEach(() => {
  read = vi.fn(async ({ functionName, args }) => nativeRead(functionName, args));
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
  it("supports Kuru's price precision above the settlement token's decimals", async () => {
    const official = [100_000_000, 10_000_000_000n, zeroAddress, 18n, addr("6"), 6n, 100,
      2_000_000_000_000n, 2_000_000_000_000_000_000n, 0n, 0n] as const;
    read.mockImplementation(async ({ functionName, args }) => functionName === "getMarketParams" ? official : nativeRead(functionName, args));
    const plugin = await create_kuru(options());
    const buy = plugin.definition.atomic_spot!.routes[0]!;
    const encoded = 1_000_000n * BigInt(buy.numerator) / BigInt(buy.denominator);
    expect(encoded).toBe(100_000_000n);
    expect(encoded * BigInt(buy.denominator) / BigInt(buy.numerator)).toBe(1_000_000n);
    const context = { client: client(), credit_id: word("d"), account: addr("2"), borrower: addr("1"),
      block: { number: 1n, hash: word("a") }, market: plugin.markets[0]!, minimum_receive: 1n };
    const plan = await plugin.actions.place_order.build({ ...context, action: { use_case: "spot", capability: "place_order",
      params: { market_id: addr("7"), direction: "sell", order_type: "market", amount: { spend: 10n ** 18n }, slippage_bps: 50 } } });
    expect(plan.calls[0]!.value).toBe(10n ** 18n);
    expect(plan.calls[0]!.spend_amount).toBe(0n);
    const state = await plugin.account.read(context);
    expect((await plugin.exit.next({ ...context, state, slippage_bps: 50, minimum_receive: async () => 1n })).status).toBe("execute");
  });
  it("pins the vault, margin account, factory and forwarder with the market", async () => {
    const plugin = await create_kuru(options());
    for (const n of ["a", "b", "c", "d"]) expect(plugin.definition.pins.some((p) => p.target === addr(n))).toBe(true);
    read.mockImplementation(async ({ functionName, args }) => functionName === "marginAccountAddress" ? addr("e") : nativeRead(functionName, args));
    await expect(create_kuru(options())).rejects.toThrow("integration-kuru-dependency-mismatch");
  });
  it("reports every unavailable source without producing a partially verified plugin", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("platform")
      ? new Response(JSON.stringify({ chain_id: 143, router: addr("3"), module: addr("4"), read_program: addr("8") }))
      : new Response(JSON.stringify({ error: "integration-source-unverified" }), { status: 400 })));
    try { await create_kuru(options()); throw new Error("Expected source verification to fail"); }
    catch (error) {
      expect(error).toBeInstanceOf(KuruSourceUnavailableError);
      const missing = (error as KuruSourceUnavailableError).failures.map((item) => item.target);
      for (const n of ["3", "4", "7", "a", "b", "c", "d", "5", "6", "9"]) expect(missing).toContain(addr(n));
    }
  });
});
