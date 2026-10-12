import { afterEach, beforeEach, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { configuredEvmSources, evmSourceRpcUrl, evmWormholeChain, isEvmSource } from "../../src/chain/networks.js";

const original = { monadChainId: env.monadChainId, sourceRpcUrl: env.sourceRpcUrl, evmSourceRpcUrls: env.evmSourceRpcUrls };
beforeEach(() => {
  env.monadChainId = 10143;
  env.sourceRpcUrl = "https://sepolia.example";
  env.evmSourceRpcUrls = '{"84532":"https://base-sepolia.example"}';
});
afterEach(() => Object.assign(env, original));

it("selects each collateral chain without replacing the Ethereum source", () => {
  expect(evmSourceRpcUrl(11155111n)).toBe("https://sepolia.example");
  expect(evmSourceRpcUrl(84532n)).toBe("https://base-sepolia.example");
  expect(configuredEvmSources()).toHaveLength(2);
  expect(evmWormholeChain(84532)).toBe(10004);
  expect(evmWormholeChain(11155111)).toBe(10002);
});
it("separates mainnet and testnet source identities", () => {
  expect(isEvmSource(8453)).toBe(false);
  expect(() => evmWormholeChain(8453)).toThrow("evm-source-chain-unsupported");
  env.monadChainId = 143; env.evmSourceRpcUrls = '{"8453":"https://base.example"}';
  expect(evmSourceRpcUrl(8453)).toBe("https://base.example");
  expect(evmWormholeChain(8453)).toBe(30);
  expect(isEvmSource(84532)).toBe(false);
});
it.each(['[]', '{"8453":"https://base.example"}', '{"84532":"file:///tmp/rpc"}', '{"084532":"https://base.example"}', '{"11155111":"https://other.example"}'])(
  "rejects unsupported, malformed or conflicting configuration: %s", (value) => {
    env.evmSourceRpcUrls = value;
    expect(() => configuredEvmSources()).toThrow("evm-source-config-invalid");
  });
it("rejects missing source endpoints instead of falling back to another chain", () => {
  env.evmSourceRpcUrls = "{}";
  expect(() => evmSourceRpcUrl(84532)).toThrow("evm-source-unconfigured");
});
