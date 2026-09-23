import {
  bytesFromHex,
  doubleSha256,
  equalBytes,
  hexFromBytes,
  MAX_BYTES,
  MAX_MONEY,
  Reader,
} from "./codec.js";

const MAX_INPUTS = 10_000;
const MAX_OUTPUTS = 10_000;
const MAX_SCRIPT = 10_000;
const MAX_WITNESS_ITEMS = 1_000;

export interface TransactionInput {
  txid: string;
  vout: number;
  sequence: number;
}

export interface TransactionOutput {
  sats: bigint;
  scriptPubKeyHex: string;
}

export interface ParsedTransaction {
  txid: string;
  version: number;
  locktime: number;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
  hasWitness: boolean;
}

export function parseTransaction(raw: Uint8Array, unsignedOnly = false): ParsedTransaction {
  const reader = new Reader(raw);
  const versionBytes = reader.readBytes(4);
  const version = new DataView(versionBytes.buffer, versionBytes.byteOffset, 4).getInt32(0, true);
  let hasWitness = false;
  if (reader.remaining >= 2 && raw[reader.offset] === 0) {
    if (raw[reader.offset + 1] !== 1 || unsignedOnly)
      throw new Error("Unsupported transaction witness flag");
    reader.readBytes(2);
    hasWitness = true;
  }

  const vinStart = reader.offset;
  const inputCount = reader.readCompactSize(MAX_INPUTS);
  if (inputCount === 0) throw new Error("Transaction has no inputs");
  const inputs: TransactionInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < inputCount; i++) {
    const txid = hexFromBytes(reader.readBytes(32).slice().reverse());
    const vout = reader.readU32();
    const scriptLength = reader.readCompactSize(MAX_SCRIPT);
    const scriptSig = reader.readBytes(scriptLength);
    if (unsignedOnly && scriptSig.length !== 0)
      throw new Error("Unsigned PSBT transaction contains scriptSig");
    const sequence = reader.readU32();
    const outpoint = `${txid}:${vout}`;
    if (seen.has(outpoint)) throw new Error("Duplicate transaction input");
    seen.add(outpoint);
    inputs.push({ txid, vout, sequence });
  }

  const outputCount = reader.readCompactSize(MAX_OUTPUTS);
  if (outputCount === 0) throw new Error("Transaction has no outputs");
  const outputs: TransactionOutput[] = [];
  let total = 0n;
  for (let i = 0; i < outputCount; i++) {
    const sats = reader.readU64();
    total += sats;
    if (sats > MAX_MONEY || total > MAX_MONEY) throw new Error("Bitcoin amount exceeds supply");
    const scriptLength = reader.readCompactSize(MAX_SCRIPT);
    const scriptPubKeyHex = hexFromBytes(reader.readBytes(scriptLength));
    outputs.push({ sats, scriptPubKeyHex });
  }
  const afterOutputs = reader.offset;

  if (hasWitness) {
    let nonemptyWitnesses = 0;
    for (let i = 0; i < inputCount; i++) {
      const itemCount = reader.readCompactSize(MAX_WITNESS_ITEMS);
      if (itemCount > 0) nonemptyWitnesses++;
      for (let j = 0; j < itemCount; j++) reader.readBytes(reader.readCompactSize(MAX_BYTES));
    }
    if (nonemptyWitnesses === 0) throw new Error("Superfluous transaction witness");
  }

  const locktimeBytes = reader.readBytes(4);
  const locktime = new DataView(locktimeBytes.buffer, locktimeBytes.byteOffset, 4).getUint32(
    0,
    true,
  );
  reader.assertEnd();
  const stripped = new Uint8Array(4 + afterOutputs - vinStart + 4);
  stripped.set(versionBytes, 0);
  stripped.set(raw.subarray(vinStart, afterOutputs), 4);
  stripped.set(locktimeBytes, stripped.length - 4);
  const txid = hexFromBytes(doubleSha256(stripped).reverse());
  return { txid, version, locktime, inputs, outputs, hasWitness };
}

export interface FundingExpectation {
  scriptPubKeyHex: string;
  minSats: bigint;
}

export interface FundingOutput {
  txid: string;
  vout: number;
  sats: bigint;
  scriptPubKeyHex: string;
  confirmation: "unverified";
}

export function inspectFundingTransaction(
  rawHex: string,
  expectation: FundingExpectation,
): FundingOutput {
  const script = bytesFromHex(expectation.scriptPubKeyHex);
  if (script.length !== 34 || script[0] !== 0 || script[1] !== 0x20) {
    throw new Error("Expected lock must be native P2WSH");
  }
  if (expectation.minSats <= 0n || expectation.minSats > MAX_MONEY)
    throw new Error("Invalid minimum amount");
  const transaction = parseTransaction(bytesFromHex(rawHex));
  const matches = transaction.outputs.flatMap((output, vout) =>
    equalBytes(bytesFromHex(output.scriptPubKeyHex), script) ? [{ ...output, vout }] : [],
  );
  if (matches.length !== 1)
    throw new Error("Funding transaction must have one matching lock output");
  if (matches[0].sats < expectation.minSats) throw new Error("Funding amount below minimum");
  return { txid: transaction.txid, ...matches[0], confirmation: "unverified" };
}
