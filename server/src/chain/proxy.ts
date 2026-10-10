import { proxyImplementationSlots, proxyBeaconSlot, resolveProxyImplementation } from "@termbook/schema";
import type { Address, PublicClient } from "viem";

export async function readProxyImplementation(client: PublicClient, address: Address, blockNumber: bigint) {
  const words = await Promise.all([...proxyImplementationSlots, proxyBeaconSlot]
    .map((slot) => client.getStorageAt({ address, slot, blockNumber })));
  return resolveProxyImplementation(words.slice(0, -1), words.at(-1));
}
