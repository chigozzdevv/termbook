import { describe, expect, it } from "vitest";
import { proxyImplementationSlots, resolveProxyImplementation } from "../src/proxy.js";

const zero = `0x${"0".repeat(64)}`;
const implementation = `0x${"11".repeat(20)}`;
const word = `0x${"0".repeat(24)}${implementation.slice(2)}`;

describe("proxy implementation layouts", () => {
  it("recognizes EIP-1967 and legacy OpenZeppelin slots without treating a proxy as immutable", () => {
    expect(resolveProxyImplementation([word, zero], zero)).toEqual({ implementation, slot: proxyImplementationSlots[0] });
    expect(resolveProxyImplementation([zero, word], zero)).toEqual({ implementation, slot: proxyImplementationSlots[1] });
    expect(resolveProxyImplementation([zero, zero], zero)).toBeNull();
  });
  it("rejects ambiguous, beacon, truncated and missing storage responses", () => {
    for (const [words, beacon] of [
      [[word, word], zero], [[zero, zero], word], [[word, "0x01"], zero],
      [[word, undefined], zero], [[word, zero], undefined],
    ] as const) expect(() => resolveProxyImplementation(words, beacon)).toThrow("integration-proxy-layout-unsupported");
  });
});
