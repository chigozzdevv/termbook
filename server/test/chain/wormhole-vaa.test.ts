import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, hexToBytes, keccak256, padHex, stringToHex, type Hex } from "viem";
import { fetchWormholeVaaById } from "../../src/chain/wormhole-vaa.js";
import { env } from "../../src/config/env.js";

const emitter = "0x1111111111111111111111111111111111111111" as const;
const digest = `0x${"2".repeat(64)}` as Hex;
const payload = encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }],
  [keccak256(stringToHex("Termbook Wormhole authorization v1")), digest],
);

function signedVaa(consistency = 0, message = payload): number[] {
  const raw = new Uint8Array(6 + 66 + 51 + hexToBytes(message).length);
  raw[0] = 1;
  raw[5] = 1;
  const body = 72;
  const view = new DataView(raw.buffer);
  view.setUint16(body + 8, 48, false);
  view.setBigUint64(body + 42, 7n, false);
  raw.set(hexToBytes(padHex(emitter, { size: 32 })), body + 10);
  raw[body + 50] = consistency;
  raw.set(hexToBytes(message), body + 51);
  return Array.from(raw);
}

afterEach(() => {
  vi.unstubAllGlobals();
  env.wormholeScanUrl = "";
});

describe("EVM Wormhole proof retrieval", () => {
  it("pins the source emitter, finalized consistency, and exact payload", async () => {
    env.wormholeScanUrl = "https://scan.example";
    let vaa = signedVaa();
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      expect(url.toString()).toMatch(new RegExp(
        `^https://scan\\.example/api/v1/vaas/48/${padHex(emitter, { size: 32 }).slice(2)}/[78]$`,
      ));
      return new Response(JSON.stringify({ data: [{ emitterChain: 48, vaa }] }), { status: 200 });
    }));
    const proof = await fetchWormholeVaaById({ chain: 48, emitter, sequence: 7n, payload });
    expect(proof.header).toBe(`0x${Buffer.from(vaa).toString("hex")}`);
    expect(proof.proof).toBe("0x");
    await expect(fetchWormholeVaaById({ chain: 48, emitter, sequence: 8n, payload }))
      .rejects.toThrow("wormhole-vaa-unavailable");
    vaa = signedVaa(1);
    await expect(fetchWormholeVaaById({ chain: 48, emitter, sequence: 7n, payload }))
      .rejects.toThrow("wormhole-vaa-unavailable");
    vaa = signedVaa(0, encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }],
      [keccak256(stringToHex("Termbook Wormhole authorization v1")), `0x${"3".repeat(64)}`],
    ));
    await expect(fetchWormholeVaaById({ chain: 48, emitter, sequence: 7n, payload }))
      .rejects.toThrow("wormhole-vaa-unavailable");
  });
});
