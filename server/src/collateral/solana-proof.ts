import type { Hex } from "viem";

const word = /^0x[0-9a-fA-F]{64}$/;
const blob = /^0x(?:[0-9a-fA-F]{2})+$/;
const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
  producer.pathname = `${producer.pathname.replace(/\/$/, "")}/${input.kind}/${id}`;
  producer.search = "";
  const response = await fetch(producer, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  if (!response) throw new Error("solana-proof-unavailable");
  const envelope = await json(response);
  const header = hex(envelope["header"], blob);
  const proof = hex(envelope["proof"], blob);
  if (header.length > 192_002 || proof.length > 192_002
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
  const finalized = await rpc(source, "getSlot", [{ commitment: "finalized" }]);
  if (!Number.isSafeInteger(finalized) || (finalized as number) < slot) throw new Error("solana-proof-not-finalized");
  const block = object(await rpc(source, "getBlock", [slot, {
    commitment: "finalized", transactionDetails: "none", rewards: false,
  }]));
  if (block["blockhash"] !== blockhash) throw new Error("solana-proof-block-mismatch");
  return { header, proof, slot, blockhash };
}
