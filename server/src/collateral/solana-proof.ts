import { bytesToHex, encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";

const word = /^0x[0-9a-fA-F]{64}$/;
const blob = /^0x(?:[0-9a-fA-F]{2})+$/;
const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const signature = /^[1-9A-HJ-NP-Za-km-z]{85,88}$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("solana-proof-invalid");
  return value as Record<string, unknown>;
}

function endpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("solana-proof-config-invalid");
  return url;
}

function hex(value: unknown, pattern: RegExp): Hex {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("solana-proof-invalid");
  return value.toLowerCase() as Hex;
}

export function solanaBase58Bytes(value: string): Hex {
  if (value.length < 32 || value.length > 44) throw new Error("solana-proof-invalid");
  let number = 0n;
  for (const char of value) {
    const digit = base58.indexOf(char);
    if (digit < 0) throw new Error("solana-proof-invalid");
    number = number * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index--) {
    bytes[index] = Number(number & 255n);
    number >>= 8n;
  }
  if (number !== 0n) throw new Error("solana-proof-invalid");
  const hex = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading++;
  let encoded = "";
  let n = BigInt(hex);
  while (n > 0n) {
    encoded = base58[Number(n % 58n)] + encoded;
    n /= 58n;
  }
  if (`${"1".repeat(leading)}${encoded}` !== value) throw new Error("solana-proof-invalid");
  return hex;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error("solana-proof-unavailable");
  const body = await response.text();
  if (body.length > 500_000) throw new Error("solana-proof-invalid");
  try {
    return object(JSON.parse(body));
  } catch {
    throw new Error("solana-proof-invalid");
  }
}

async function rpc(url: URL, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000), redirect: "error",
  }).catch(() => null);
  if (!response) throw new Error("solana-proof-unavailable");
  const result = await json(response);
  if (result["jsonrpc"] !== "2.0" || result["id"] !== 1 || result["error"]
    || result["result"] === undefined) throw new Error("solana-proof-unavailable");
  return result["result"];
}

export type SolanaProof = {
  header: Hex;
  proof: Hex;
  slot: number;
  blockhash: string;
};

const snapshotDomain = keccak256(stringToHex("Termbook Solana snapshot v1"));

function signedSnapshot(vaa: string, account: Hex): Hex | null {
  if (vaa.length > 128_000 || vaa.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(vaa)) return null;
  let raw: Uint8Array;
  try { raw = Uint8Array.from(Buffer.from(vaa, "base64")); } catch { return null; }
  if (raw.length < 6 || raw.length > 96_000 || raw[0] !== 1
    || Buffer.from(raw).toString("base64") !== vaa) return null;
  const count = raw[5]!;
  const start = 6 + count * 66;
  if (!count || raw.length < start + 51 + 76) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (view.getUint16(start + 8, false) !== 1 || raw[start + 50] !== 1) return null;
  const payload = raw.subarray(start + 51);
  if (bytesToHex(payload.subarray(0, 32)) !== snapshotDomain
    || bytesToHex(payload.subarray(32, 64)).toLowerCase() !== account.toLowerCase()
    || payload.length !== 76 + view.getUint32(start + 51 + 72, true)) return null;
  return bytesToHex(raw);
}

async function proofBySourceTx(
  source: URL, explorer: URL, tx: string, account: Hex,
): Promise<{ header: Hex; slot: number; blockhash: string }> {
  if (!signature.test(tx)) throw new Error("solana-proof-invalid");
  const transaction = object(await rpc(source, "getTransaction", [tx,
    { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]));
  const slot = transaction["slot"];
  const meta = object(transaction["meta"]);
  if (!Number.isSafeInteger(slot) || (slot as number) <= 0 || meta["err"] !== null) {
    throw new Error("solana-proof-unavailable");
  }
  const block = object(await rpc(source, "getBlock", [slot,
    { commitment: "finalized", transactionDetails: "none", rewards: false }]));
  const blockhash = block["blockhash"];
  if (typeof blockhash !== "string") throw new Error("solana-proof-unavailable");
  solanaBase58Bytes(blockhash);
  explorer.pathname = `${explorer.pathname.replace(/\/$/, "")}/api/v1/vaas`;
  explorer.search = new URLSearchParams({ txHash: tx, pageSize: "100" }).toString();
  const response = await fetch(explorer, { signal: AbortSignal.timeout(10_000), redirect: "error" })
    .catch(() => null);
  if (!response) throw new Error("solana-proof-unavailable");
  const result = await json(response);
  const entries = result["data"];
  if (!Array.isArray(entries) || entries.length > 100) throw new Error("solana-proof-invalid");
  const matches = entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (item["emitterChain"] !== 1 || typeof item["vaa"] !== "string") return [];
    const header = signedSnapshot(item["vaa"], account);
    return header ? [header] : [];
  });
  if (matches.length !== 1) throw new Error("solana-proof-unavailable");
  return { header: matches[0]!, slot: slot as number, blockhash };
}

export async function solanaFinalizedClock(rpcUrl: string): Promise<number> {
  const source = endpoint(rpcUrl);
  const slot = await rpc(source, "getSlot", [{ commitment: "finalized" }]);
  if (!Number.isSafeInteger(slot) || (slot as number) <= 0) throw new Error("solana-proof-invalid");
  const timestamp = await rpc(source, "getBlockTime", [slot]);
  if (!Number.isSafeInteger(timestamp) || (timestamp as number) <= 0) throw new Error("solana-proof-unavailable");
  return timestamp as number;
}

export async function fetchSolanaProof(input: {
  rpcUrl: string;
  proofUrl: string;
  kind: "lock" | "action" | "recovery";
  id: Hex;
  digest: Hex;
  genesis: Hex;
  programId: Hex;
  programDataHash: Hex;
  lockPda: Hex;
  accountPda?: Hex;
  sourceTx?: string;
}): Promise<SolanaProof> {
  const source = endpoint(input.rpcUrl);
  const producer = endpoint(input.proofUrl);
  const id = hex(input.id, word);
  const digest = hex(input.digest, word);
  const genesis = hex(input.genesis, word);
  const programId = hex(input.programId, word);
  const programDataHash = hex(input.programDataHash, word);
  const lockPda = hex(input.lockPda, word);
  const accountPda = input.accountPda ? hex(input.accountPda, word) : lockPda;
  if ([id, digest, genesis, programId, programDataHash, lockPda, accountPda]
    .some((value) => BigInt(value) === 0n)
    || (input.kind === "recovery" && !input.accountPda)
    || (input.kind !== "recovery" && input.accountPda)) throw new Error("solana-proof-invalid");
  const rpcGenesis = await rpc(source, "getGenesisHash", []);
  if (typeof rpcGenesis !== "string" || solanaBase58Bytes(rpcGenesis) !== genesis) throw new Error("solana-genesis-mismatch");
  const proof = encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes" }, { type: "bytes" },
  ], [accountPda, "0x01", "0x02"]);
  if (input.sourceTx) {
    const signed = await proofBySourceTx(source, producer, input.sourceTx, accountPda);
    return { ...signed, proof };
  }
  producer.pathname = `${producer.pathname.replace(/\/$/, "")}/${input.kind}/${id}`;
  producer.search = "";
  const response = await fetch(producer, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  if (!response) throw new Error("solana-proof-unavailable");
  const envelope = await json(response);
  const header = hex(envelope["vaa"], blob);
  if (header.length > 192_002
    || hex(envelope["digest"], word) !== digest
    || hex(envelope["sourceGenesis"], word) !== genesis
    || hex(envelope["programId"], word) !== programId
    || hex(envelope["programDataHash"], word) !== programDataHash
    || hex(envelope["lockPda"], word) !== lockPda
    || (input.kind === "recovery" && hex(envelope["accountPda"], word) !== accountPda)
    || !Number.isSafeInteger(envelope["slot"]) || (envelope["slot"] as number) <= 0
    || typeof envelope["blockhash"] !== "string") throw new Error("solana-proof-invalid");
  const slot = envelope["slot"] as number;
  const blockhash = envelope["blockhash"] as string;
  solanaBase58Bytes(blockhash);
  return { header, proof, slot, blockhash };
}
