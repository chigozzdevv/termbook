import { bytesToHex, padHex, type Address, type Hex } from "viem";
import { env } from "../config/env.js";

type VaaProof = { header: Hex; proof: Hex };

function decodeVaa(value: unknown, chain: number, emitter: Hex, payload: Hex, sequence?: bigint): Hex | null {
  let raw: Uint8Array;
  if (typeof value === "string" && value.length <= 128_000 && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    raw = Uint8Array.from(Buffer.from(value, "base64"));
    if (Buffer.from(raw).toString("base64") !== value) return null;
  } else if (Array.isArray(value) && value.length <= 96_000
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    raw = Uint8Array.from(value);
  } else {
    return null;
  }
  if (raw.length < 57 || raw.length > 96_000 || raw[0] !== 1 || raw[5] === 0) return null;
  const start = 6 + raw[5]! * 66;
  if (start + 51 > raw.length) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint16(start + 8, false) !== chain || raw[start + 50] !== 0
    || (sequence !== undefined && view.getBigUint64(start + 42, false) !== sequence)
    || bytesToHex(raw.subarray(start + 10, start + 42)).toLowerCase() !== emitter.toLowerCase()
    || bytesToHex(raw.subarray(start + 51)).toLowerCase() !== payload.toLowerCase()) return null;
  return bytesToHex(raw);
}

async function request(url: URL, chain: number, emitter: Hex, payload: Hex, sequence?: bigint): Promise<VaaProof> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" })
    .catch(() => null);
  if (!response?.ok) throw new Error("wormhole-vaa-unavailable");
  const body = await response.text();
  if (body.length > 500_000) throw new Error("wormhole-vaa-invalid");
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw new Error("wormhole-vaa-invalid"); }
  if (!data || typeof data !== "object") throw new Error("wormhole-vaa-invalid");
  const result = (data as Record<string, unknown>)["data"];
  const entries = Array.isArray(result) ? result
    : result && typeof result === "object" ? [result] : [];
  if (entries.length === 0 || entries.length > 100) throw new Error("wormhole-vaa-invalid");
  const matches = entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const header = decodeVaa(item["vaa"], chain, emitter, payload, sequence);
    return header ? [header] : [];
  });
  if (matches.length !== 1) throw new Error("wormhole-vaa-unavailable");
  return { header: matches[0]!, proof: "0x" };
}

function base(): URL {
  if (!env.wormholeScanUrl) throw new Error("wormhole-scan-unconfigured");
  const url = new URL(env.wormholeScanUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("wormhole-scan-invalid");
  return url;
}

export async function fetchWormholeVaaById(input: {
  chain: number; emitter: Address; sequence: bigint; payload: Hex;
}): Promise<VaaProof> {
  const url = base();
  const emitter = padHex(input.emitter, { size: 32 });
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v1/vaas/${input.chain}/${emitter.slice(2)}/${input.sequence}`;
  url.search = "";
  return request(url, input.chain, emitter, input.payload, input.sequence);
}
