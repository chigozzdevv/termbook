import { bls12_381 } from "@noble/curves/bls12-381";
import { describe, expect, it } from "vitest";
import { buildBeaconWitness } from "../../src/chain/ethereum-beacon-witness.js";

const asHex = (value: Uint8Array): `0x${string}` => `0x${Buffer.from(value).toString("hex")}`;
const field = (value: bigint) => value.toString(16).padStart(128, "0");

describe("Ethereum Beacon witness", () => {
  it("encodes selected G1 keys and the G2 signature for EIP-2537", () => {
    const key = asHex(bls12_381.G1.ProjectivePoint.BASE.toRawBytes(true));
    const second = asHex(bls12_381.G1.ProjectivePoint.BASE.multiply(2n).toRawBytes(true));
    const signature = asHex(bls12_381.G2.ProjectivePoint.BASE.toRawBytes(true));
    const pubkeys = Array<`0x${string}`>(512).fill(key);
    pubkeys[341] = second;
    const bits = Buffer.alloc(64);
    bits.fill(0xff, 0, 42);
    bits[42] = 0x3f;
    const witness = buildBeaconWitness({ pubkeys, aggregatePubkey: key, bits: asHex(bits), signature });
    const first = bls12_381.G1.ProjectivePoint.BASE.toAffine();
    const last = bls12_381.G1.ProjectivePoint.BASE.multiply(2n).toAffine();
    const sig = bls12_381.G2.ProjectivePoint.BASE.toAffine();

    expect(witness.compressedPubkeys.length).toBe(2 + 512 * 48 * 2);
    expect(witness.uncompressedParticipants.length).toBe(2 + 342 * 128 * 2);
    expect(witness.uncompressedParticipants.slice(2, 2 + 256)).toBe(field(first.x) + field(first.y));
    expect(witness.uncompressedParticipants.slice(-256)).toBe(field(last.x) + field(last.y));
    expect(witness.signature).toBe(`0x${field(sig.x.c0)}${field(sig.x.c1)}${field(sig.y.c0)}${field(sig.y.c1)}`);
  });

  it("rejects a committee below the finality threshold", () => {
    const key = asHex(bls12_381.G1.ProjectivePoint.BASE.toRawBytes(true));
    const signature = asHex(bls12_381.G2.ProjectivePoint.BASE.toRawBytes(true));
    expect(() => buildBeaconWitness({
      pubkeys: Array<`0x${string}`>(512).fill(key), aggregatePubkey: key,
      bits: asHex(Buffer.alloc(64)), signature,
    })).toThrow("beacon-witness-invalid");
  });
});
