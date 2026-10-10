import { proxyImplementationSlots, proxyBeaconSlot, resolveProxyImplementation, type PluginDefinition } from "@termbook/schema";
import { keccak256, type Address, type Hex, type PublicClient } from "viem";

export const implementation_slot = proxyImplementationSlots[0];
export const legacy_implementation_slot = proxyImplementationSlots[1];

async function readProxy(client: PublicClient, address: Address, blockNumber: bigint) {
  const words = await Promise.all([...proxyImplementationSlots, proxyBeaconSlot]
    .map((slot) => client.getStorageAt({ address, slot, blockNumber })));
  return resolveProxyImplementation(words.slice(0, -1), words.at(-1));
}

export async function verify_definition(client: PublicClient, definition: PluginDefinition, block_number?: bigint): Promise<void> {
  if (await client.getChainId() !== definition.chain_id) throw new Error("integration-chain-mismatch");
  const block = await client.getBlock(block_number === undefined ? { blockTag: "finalized" } : { blockNumber: block_number });
  for (let offset = 0; offset < definition.pins.length; offset += 8) await Promise.all(definition.pins.slice(offset, offset + 8).map(async (pin) => {
    const [code, proxy] = await Promise.all([
      client.getBytecode({ address: pin.target as Address, blockNumber: block.number }),
      readProxy(client, pin.target as Address, block.number),
    ]);
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== pin.code_hash.toLowerCase()) throw new Error("integration-code-changed");
    if (pin.implementation) {
      if (!proxy || proxy.slot !== pin.implementation_slot
        || proxy.implementation.toLowerCase() !== pin.implementation.toLowerCase()) throw new Error("integration-implementation-changed");
      const implementation = await client.getBytecode({ address: pin.implementation as Address, blockNumber: block.number });
      if (!implementation || implementation === "0x" || keccak256(implementation).toLowerCase() !== pin.implementation_code_hash?.toLowerCase()) {
        throw new Error("integration-implementation-changed");
      }
    } else {
      if (proxy) throw new Error("integration-proxy-pin-required");
    }
  }));
  const canonical = await client.getBlock({ blockNumber: block.number });
  if (canonical.hash !== block.hash) throw new Error("integration-state-noncanonical");
}

export async function pin_contract(client: PublicClient, address: Address, block_number: bigint) {
  const [code, proxy] = await Promise.all([client.getBytecode({ address, blockNumber: block_number }), readProxy(client, address, block_number)]);
  if (!code || code === "0x") throw new Error("integration-target-unavailable");
  if (!proxy) return { target: address, code_hash: keccak256(code) };
  const implementation = proxy.implementation;
  const implementationCode = await client.getBytecode({ address: implementation, blockNumber: block_number });
  if (!implementationCode || implementationCode === "0x") throw new Error("integration-implementation-unavailable");
  return { target: address, code_hash: keccak256(code), implementation,
    implementation_code_hash: keccak256(implementationCode) as Hex, implementation_slot: proxy.slot };
}
