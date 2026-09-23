import { createHash } from "node:crypto";

export const MAX_MONEY = 2_100_000_000_000_000n;
export const MAX_BYTES = 1_000_000;

export function bytesFromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error("Invalid hex");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function hexFromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function sha256(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(bytes).digest());
}

export function doubleSha256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

export class Reader {
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    if (bytes.length > MAX_BYTES) throw new Error("Payload too large");
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readBytes(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new Error("Truncated payload");
    }
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  readU8(): number {
    return this.readBytes(1)[0];
  }

  readU16(): number {
    const bytes = this.readBytes(2);
    return bytes[0] | (bytes[1] << 8);
  }

  readU32(): number {
    const bytes = this.readBytes(4);
    return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  }

  readU64(): bigint {
    const bytes = this.readBytes(8);
    let value = 0n;
    for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
    return value;
  }

  readCompactSize(maximum = MAX_BYTES): number {
    const prefix = this.readU8();
    let value: bigint;
    if (prefix < 0xfd) value = BigInt(prefix);
    else if (prefix === 0xfd) {
      value = BigInt(this.readU16());
      if (value < 0xfdn) throw new Error("Noncanonical CompactSize");
    } else if (prefix === 0xfe) {
      value = BigInt(this.readU32());
      if (value <= 0xffffn) throw new Error("Noncanonical CompactSize");
    } else {
      value = this.readU64();
      if (value <= 0xffffffffn) throw new Error("Noncanonical CompactSize");
    }
    if (value > BigInt(maximum)) throw new Error("CompactSize exceeds limit");
    return Number(value);
  }

  assertEnd(): void {
    if (this.remaining !== 0) throw new Error("Trailing bytes");
  }
}
