export const proxyImplementationSlots = [
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
] as const;
export const proxyBeaconSlot = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;

export function resolveProxyImplementation(words: readonly (string | undefined)[], beacon: string | undefined) {
  if (words.length !== proxyImplementationSlots.length || !beacon || !/^0x[0-9a-fA-F]{64}$/.test(beacon)
    || BigInt(beacon) !== 0n || words.some((word) => !word || !/^0x0{24}[0-9a-fA-F]{40}$/.test(word))) {
    throw new Error("integration-proxy-layout-unsupported");
  }
  const populated = words.flatMap((word, index) => BigInt(word!) === 0n ? [] : [{
    implementation: `0x${word!.slice(-40)}` as `0x${string}`,
    slot: proxyImplementationSlots[index]!,
  }]);
  if (populated.length > 1) throw new Error("integration-proxy-layout-unsupported");
  return populated[0] ?? null;
}
