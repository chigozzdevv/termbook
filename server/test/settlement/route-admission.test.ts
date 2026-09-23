import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { admittedRoute } from "../../src/settlement/aurora.client.js";

const routeId = `0x${"1".repeat(64)}`;
const routeVersion = `0x${"0".repeat(63)}1`;
const sourceAsset = `0x${"1".repeat(40)}`;
const vault = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const recoveryVault = `0x${"4".repeat(40)}`;
const originalRoutes = env.auroraRoutes;
const originalKey = env.auroraApiKey;

const input = {
  routeId, routeVersion, kind: "recovery", sourceChain: 1,
  sourceAsset, vault, token, maxAmountIn: "100", sourceRefundRecipient: recoveryVault,
};

afterEach(() => {
  env.auroraRoutes = originalRoutes;
  env.auroraApiKey = originalKey;
});

describe("Aurora route admission", () => {
  it("requires the exact recovery vault and amount limit", () => {
    env.auroraApiKey = "test-key";
    env.auroraRoutes = JSON.stringify([{
      routeId, routeVersion, kind: "recovery", sourceChain: 1, sourceAsset,
      sourceAssetId: "eth:1:erc20:test", destinationAssetId: "monad:erc20:test",
      vault, token, maxAmountIn: "100", slippageBps: 50, recoveryVault,
    }]);
    expect(admittedRoute(input).recoveryVault).toBe(recoveryVault);
    expect(() => admittedRoute({ ...input, sourceRefundRecipient: sourceAsset })).toThrowError("settlement-route-not-admitted");
    expect(() => admittedRoute({ ...input, maxAmountIn: "101" })).toThrowError("settlement-route-not-admitted");
    expect(() => admittedRoute({ ...input, routeVersion: routeId })).toThrowError("settlement-route-not-admitted");
  });

  it("admits a native Solana refund address only on a Solana route", () => {
    const recoveryPubkey = "So11111111111111111111111111111111111111112";
    env.auroraApiKey = "test-key";
    const route = {
      routeId, routeVersion, kind: "recovery", sourceChain: 99, sourceAsset,
      sourceAssetId: "sol:mainnet:native", destinationAssetId: "monad:erc20:test",
      sourceAddressFormat: "solana", vault, token, maxAmountIn: "100",
      slippageBps: 50,
    };
    env.auroraRoutes = JSON.stringify([route]);
    const solanaInput = { ...input, sourceChain: 99, sourceRefundRecipient: recoveryPubkey };
    expect(admittedRoute(solanaInput).sourceAddressFormat).toBe("solana");
    expect(() => admittedRoute({ ...solanaInput, sourceRefundRecipient: recoveryVault }))
      .toThrowError("settlement-route-not-admitted");
    env.auroraRoutes = JSON.stringify([{ ...route, recoveryVault: recoveryPubkey }]);
    expect(() => admittedRoute(solanaInput)).toThrowError("settlement-route-not-admitted");
  });
});
