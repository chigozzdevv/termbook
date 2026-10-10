import { describe, expect, it, vi } from "vitest";
import { proxyImplementationSlots, proxyBeaconSlot } from "@termbook/schema";
import { keccak256, type Hex, type PublicClient } from "viem";
import { pin_contract, verify_definition } from "../src/integration/pins.js";
import { definition, addr, word } from "./plugin.fixture.js";

const storage = (implementation: string) => `0x${"0".repeat(24)}${implementation.slice(2)}`;
const block = { number: 100n, hash: word("f") };

function client() {
  return { getChainId: vi.fn(async () => 143), getBlock: vi.fn(async () => block),
    getBytecode: vi.fn(async () => "0x1234" as Hex),
    getStorageAt: vi.fn(async ({ address, slot }: { address: string; slot: string }) =>
      address === addr("3") && slot === proxyImplementationSlots[1] ? storage(addr("8")) as Hex : word("0")) };
}

describe("legacy proxy pins", () => {
  it("pins the implementation and refuses a slot migration or implementation replacement", async () => {
    const chain = client(), rpc = chain as unknown as PublicClient;
    const pin = await pin_contract(rpc, addr("3"), block.number);
    expect(pin).toMatchObject({ implementation: addr("8"), implementation_slot: proxyImplementationSlots[1], implementation_code_hash: keccak256("0x1234") });
    const d = definition(); d.pins[0] = pin;
    await verify_definition(rpc, d);
    chain.getStorageAt.mockImplementation(async ({ address, slot }) => address === addr("3") && slot === proxyImplementationSlots[1]
      ? storage(addr("9")) as Hex : word("0"));
    await expect(verify_definition(rpc, d)).rejects.toThrow("integration-implementation-changed");
    chain.getStorageAt.mockImplementation(async ({ address, slot }) => address === addr("3") && slot === proxyImplementationSlots[0]
      ? storage(addr("8")) as Hex : word("0"));
    await expect(verify_definition(rpc, d)).rejects.toThrow("integration-implementation-changed");
  });
  it("rejects a legacy proxy presented as an immutable dependency and any beacon layout", async () => {
    const chain = client(), rpc = chain as unknown as PublicClient;
    await expect(verify_definition(rpc, definition())).rejects.toThrow("integration-proxy-pin-required");
    chain.getStorageAt.mockImplementation(async ({ slot }) => slot === proxyBeaconSlot ? storage(addr("8")) as Hex : word("0"));
    await expect(pin_contract(rpc, addr("3"), block.number)).rejects.toThrow("integration-proxy-layout-unsupported");
  });
});
