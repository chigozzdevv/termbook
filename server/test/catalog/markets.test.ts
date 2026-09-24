import { describe, expect, it, vi } from "vitest";
import { catalogService } from "../../src/catalog/catalog.service.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/house/house.service.js", () => ({ houseService: { list: vi.fn(async () => []) } }));
vi.mock("../../src/integration/integration.service.js", () => ({ integrationService: { list: vi.fn(async () => []) } }));
vi.mock("../../src/config/env.js", () => ({ env: {
  core: `0x${"1".repeat(40)}`, monadChainId: 143,
  collateralMarkets: JSON.stringify([{ id: "sol", label: "SOL", kind: "solana", decimals: 9, chainId: 101,
    rpcUrl: "https://solana.example", genesis: `0x${"2".repeat(64)}`,
    asset: `0x${"01".repeat(32)}`, program: `0x${"3".repeat(64)}` }]),
} }));

describe("published collateral markets", () => {
  it("matches the Solana genesis, program, asset, and recovery vault in Core", async () => {
    const readContract = vi.fn(async () => [`0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`,
      NATIVE_SOL_ASSET_BYTES, `0x${"4".repeat(64)}`, true]);
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 100n }), readContract } as never);
    expect((await catalogService.overview()).collateralMarkets.map((market) => market.id)).toEqual(["sol"]);
    readContract.mockResolvedValueOnce([`0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`,
      `0x${"5".repeat(64)}`, `0x${"4".repeat(64)}`, true]);
    expect((await catalogService.overview()).collateralMarkets).toEqual([]);
  });
});
