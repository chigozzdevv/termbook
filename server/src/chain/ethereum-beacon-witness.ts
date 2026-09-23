import { bls12_381 } from "@noble/curves/bls12-381";
import { concatHex, type Hex } from "viem";

const compressedG1 = /^0x[0-9a-fA-F]{96}$/;
const compressedG2 = /^0x[0-9a-fA-F]{192}$/;
const bitsPattern = /^0x[0-9a-fA-F]{128}$/;

function field(value: bigint): Hex {
  if (value < 0n || value >= 1n << 384n) throw new Error("beacon-witness-invalid");
  return `0x${value.toString(16).padStart(128, "0")}`;
}

function g1(value: Hex): Hex {
  if (!compressedG1.test(value)) throw new Error("beacon-witness-invalid");
  const point = bls12_381.G1.ProjectivePoint.fromHex(value.slice(2));
  if (point.equals(bls12_381.G1.ProjectivePoint.ZERO)) throw new Error("beacon-witness-invalid");
  point.assertValidity();
  const { x, y } = point.toAffine();
  return concatHex([field(x), field(y)]);
}

function g2(value: Hex): Hex {
  if (!compressedG2.test(value)) throw new Error("beacon-witness-invalid");
  const point = bls12_381.G2.ProjectivePoint.fromHex(value.slice(2));
  if (point.equals(bls12_381.G2.ProjectivePoint.ZERO)) throw new Error("beacon-witness-invalid");
  point.assertValidity();
  const { x, y } = point.toAffine();
  return concatHex([field(x.c0), field(x.c1), field(y.c0), field(y.c1)]);
}

export function buildBeaconWitness(input: {
  pubkeys: Hex[];
  aggregatePubkey: Hex;
  bits: Hex;
  signature: Hex;
}) {
  if (input.pubkeys.length !== 512 || !compressedG1.test(input.aggregatePubkey)
    || !bitsPattern.test(input.bits)) throw new Error("beacon-witness-invalid");
  const selected: Hex[] = [];
  const bits = Buffer.from(input.bits.slice(2), "hex");
  for (let index = 0; index < 512; index += 1) {
    const pubkey = input.pubkeys[index];
    if (!pubkey || !compressedG1.test(pubkey)) throw new Error("beacon-witness-invalid");
    if ((bits[index >> 3]! & (1 << (index & 7))) !== 0) selected.push(g1(pubkey));
  }
  if (selected.length < 342) throw new Error("beacon-witness-invalid");
  g1(input.aggregatePubkey);
  return {
    compressedPubkeys: concatHex(input.pubkeys),
    aggregatePubkey: input.aggregatePubkey,
    uncompressedParticipants: concatHex(selected),
    signature: g2(input.signature),
  };
}
