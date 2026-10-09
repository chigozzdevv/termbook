import type { PluginDefinition } from "@termbook/schema";
import { keccak256, type Address, type Hex, type PublicClient } from "viem";

export const implementation_slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

export async function verify_definition(client: PublicClient, definition: PluginDefinition, block_number?: bigint): Promise<void> {
  if (await client.getChainId() !== definition.chain_id) throw new Error("integration-chain-mismatch");
  const block = await client.getBlock(block_number === undefined ? { blockTag: "finalized" } : { blockNumber: block_number });
  for (let offset = 0; offset < definition.pins.length; offset += 8) await Promise.all(definition.pins.slice(offset, offset + 8).map(async (pin) => {
    const [code, storage] = await Promise.all([
      client.getBytecode({ address: pin.target as Address, blockNumber: block.number }),
      client.getStorageAt({ address: pin.target as Address, slot: implementation_slot, blockNumber: block.number }),
    ]);
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== pin.code_hash.toLowerCase()) throw new Error("integration-code-changed");
    if (pin.implementation) {
      if (pin.implementation_slot !== implementation_slot) throw new Error("integration-proxy-layout-unsupported");
      if (!storage || !/^0x0{24}[0-9a-fA-F]{40}$/.test(storage)
        || `0x${storage.slice(-40)}`.toLowerCase() !== pin.implementation.toLowerCase()) throw new Error("integration-implementation-changed");
      const implementation = await client.getBytecode({ address: pin.implementation as Address, blockNumber: block.number });
      if (!implementation || implementation === "0x" || keccak256(implementation).toLowerCase() !== pin.implementation_code_hash?.toLowerCase()) {
        throw new Error("integration-implementation-changed");
      }
    } else {
      if (storage && !/^0x0*$/.test(storage)) throw new Error("integration-proxy-pin-required");
    }
  }));
  const canonical = await client.getBlock({ blockNumber: block.number });
  if (canonical.hash !== block.hash) throw new Error("integration-state-noncanonical");
}

export async function pin_contract(client: PublicClient, address: Address, block_number: bigint) {
  const [code, storage] = await Promise.all([client.getBytecode({ address, blockNumber: block_number }),
    client.getStorageAt({ address, slot: implementation_slot, blockNumber: block_number })]);
  if (!code || code === "0x") throw new Error("integration-target-unavailable");
  if (!storage || /^0x0*$/.test(storage)) return { target: address, code_hash: keccak256(code) };
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(storage)) throw new Error("integration-proxy-layout-unsupported");
  const implementation = `0x${storage.slice(-40)}` as Address;
  const implementationCode = await client.getBytecode({ address: implementation, blockNumber: block_number });
  if (!implementationCode || implementationCode === "0x") throw new Error("integration-implementation-unavailable");
  return { target: address, code_hash: keccak256(code), implementation,
    implementation_code_hash: keccak256(implementationCode) as Hex, implementation_slot };
}
