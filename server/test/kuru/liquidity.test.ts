import { afterEach, describe, expect, it, vi } from "vitest";
import { kuruLiquidityConfig, makerPrices, needsMakerUpdate } from "../../src/kuru/liquidity.worker.js";
import { env } from "../../src/config/env.js";

afterEach(() => vi.unstubAllEnvs());
const price = 25_000_000_000_000_000n, precision = 100_000_000n;

describe("testnet maker upkeep", () => {
  it("rounds both quotes to the market tick and stays inside normal trade protection", () => {
    const { bid, ask } = makerPrices(price + 1n, precision, 100n);
    expect(bid % 100n).toBe(0n); expect(ask % 100n).toBe(0n);
    expect(bid).toBeLessThan(ask);
    expect(bid * 10n ** 18n / precision).toBeLessThanOrEqual(price);
    expect(ask * 10n ** 18n / precision).toBeGreaterThanOrEqual(price);
    expect((ask * 10n ** 18n / precision - price) * 10_000n).toBeLessThan(price * 20n);
  });
  it("spends no transaction gas when existing quotes remain usable", () => {
    const { bid, ask } = makerPrices(price, precision, 100n);
    const orders = [{ buy: true, price: bid, size: 500n }, { buy: false, price: ask, size: 450n }];
    expect(needsMakerUpdate(orders, price, precision, 500n, 450n)).toBe(false);
    expect(needsMakerUpdate(orders, price, precision, 500n, 500n)).toBe(false);
    expect(needsMakerUpdate(orders, price * 101n / 100n, precision, 500n, 450n)).toBe(true);
    expect(needsMakerUpdate([orders[0]!], price, precision, 500n, 500n)).toBe(true);
    expect(needsMakerUpdate(orders, price, precision, 500n, 1000n)).toBe(true);
  });
  it("is explicitly configured and can never operate on mainnet", () => {
    vi.stubEnv("TESTNET_KURU_LIQUIDITY", ""); expect(kuruLiquidityConfig()).toBeNull();
    const config = { keyFile: ".testnet/evm.json", address: `0x${"11".repeat(20)}`, depthWei: "5000000000000000000",
      maxUpdatesPerDay: 24, minimumGasWei: "1000000000000000000" };
    vi.stubEnv("TESTNET_KURU_LIQUIDITY", JSON.stringify(config));
    const previous = env.monadChainId;
    try {
      env.monadChainId = 10143; expect(kuruLiquidityConfig()).toEqual(config);
      env.monadChainId = 143; expect(kuruLiquidityConfig).toThrow("kuru-liquidity-testnet-only");
    } finally { env.monadChainId = previous; }
  });
});
