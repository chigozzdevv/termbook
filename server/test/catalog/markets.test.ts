import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogService } from "../../src/catalog/catalog.service.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { env } from "../../src/config/env.js";
import { PublicKey } from "@solana/web3.js";
import { toHex } from "viem";
import { safeConfirmationHash } from "../../src/chain/ethereum-confirmations.js";

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
  const originalMarkets = env.collateralMarkets;
  afterEach(() => { env.monadChainId = 143; env.collateralMarkets = originalMarkets; vi.unstubAllEnvs(); });
  it("publishes Base safe custody only when its matching testnet policy is admitted", async () => {
    const address = `0x${"2".repeat(40)}` as const;
    env.collateralMarkets = JSON.stringify([{ id: "base", label: "ETH", kind: "evm", decimals: 18,
      chainId: 84532, rpcUrl: "https://base.example", vault: address, asset: address, controller: address, testnetFinality: "safe" }]);
    await expect(catalogService.overview()).rejects.toThrow("collateral-market-config-invalid");
    env.monadChainId = 10143;
    let version = 3n, hash = safeConfirmationHash(84532, address);
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 100n }),
      readContract: async ({ functionName }: { functionName: string }) => ({
        sourceCollateralVault: address, sourceRecoveryVault: address, verifierRegistry: address,
        verifiers: [address, version, true], consensusVersion: version, publisher: address, lightClient: address,
        confirmationPolicyHash: hash,
      })[functionName] } as never);
    expect((await catalogService.overview()).collateralMarkets.map((market) => market.id)).toEqual(["base"]);
    version = 1n;
    expect((await catalogService.overview()).collateralMarkets).toEqual([]);
    version = 3n; hash = safeConfirmationHash(8453, address);
    await expect(catalogService.overview()).rejects.toThrow("ethereum-confirmation-policy-invalid");
  });
  it("matches the Solana genesis, program, asset, and recovery vault in Core", async () => {
    const readContract = vi.fn(async () => [`0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`,
      `0x${"4".repeat(64)}`, NATIVE_SOL_ASSET_BYTES, true]);
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 100n }), readContract } as never);
    expect((await catalogService.overview()).collateralMarkets.map((market) => market.id)).toEqual(["sol"]);
    readContract.mockResolvedValueOnce([`0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`,
      `0x${"4".repeat(64)}`, `0x${"5".repeat(64)}`, true]);
    expect((await catalogService.overview()).collateralMarkets).toEqual([]);
  });
  it("publishes mutable programs only for devnet with the configured testnet authority", async () => {
    const genesis = toHex(new PublicKey("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG").toBytes());
    const authority = "6fr4TdJhVgwk6uUHvCEQEYYCNiBMKyVCYg1yD5YvRiA1";
    const market = { id: "sol", label: "SOL", kind: "solana", decimals: 9, chainId: 501,
      rpcUrl: "https://api.devnet.solana.com", genesis, asset: NATIVE_SOL_ASSET_BYTES,
      program: `0x${"3".repeat(64)}`, testnetUpgradeAuthority: authority };
    env.collateralMarkets = JSON.stringify([market]);
    await expect(catalogService.overview()).rejects.toThrow("collateral-market-config-invalid");
    env.monadChainId = 10143;
    vi.stubEnv("SOLANA_TESTNET_UPGRADE_AUTHORITY", "different-authority");
    await expect(catalogService.overview()).rejects.toThrow("collateral-market-config-invalid");
    vi.stubEnv("SOLANA_TESTNET_UPGRADE_AUTHORITY", authority);
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 100n }),
      readContract: async () => [genesis, market.program, `0x${"4".repeat(64)}`, NATIVE_SOL_ASSET_BYTES, true] } as never);
    expect((await catalogService.overview()).collateralMarkets[0]?.testnetUpgradeAuthority).toBe(authority);
    env.collateralMarkets = JSON.stringify([{ ...market, genesis: `0x${"2".repeat(64)}` }]);
    await expect(catalogService.overview()).rejects.toThrow("collateral-market-config-invalid");
  });
});
