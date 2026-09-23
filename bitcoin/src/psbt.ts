import {
  bytesFromHex,
  equalBytes,
  hexFromBytes,
  MAX_BYTES,
  MAX_MONEY,
  Reader,
  sha256,
} from "./codec.js";
import { parseTransaction, type TransactionInput, type TransactionOutput } from "./transaction.js";

interface KeyValue {
  key: Uint8Array;
  value: Uint8Array;
}

export interface ExpectedSpendInput extends TransactionInput {
  sats: bigint;
  scriptPubKeyHex: string;
}

export interface ExpectedSpend {
  version: number;
  locktime: number;
  inputs: ExpectedSpendInput[];
  outputs: TransactionOutput[];
  maxFeeSats: bigint;
}

export interface InspectedSpend {
  txid: string;
  inputSats: bigint;
  outputSats: bigint;
  feeSats: bigint;
}

function readMap(reader: Reader): KeyValue[] {
  const entries: KeyValue[] = [];
  const seen = new Set<string>();
  for (;;) {
    const keyLength = reader.readCompactSize(MAX_BYTES);
    if (keyLength === 0) return entries;
    const key = reader.readBytes(keyLength);
    const value = reader.readBytes(reader.readCompactSize(MAX_BYTES));
    const keyHex = hexFromBytes(key);
    if (seen.has(keyHex)) throw new Error("Duplicate PSBT key");
    seen.add(keyHex);
    entries.push({ key, value });
  }
}

function decodePsbtBase64(base64: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("Invalid PSBT base64");
  }
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bytes.length > MAX_BYTES || Buffer.from(bytes).toString("base64") !== base64) {
    throw new Error("Invalid PSBT base64");
  }
  return bytes;
}

function assertP2wsh(script: Uint8Array): void {
  if (script.length !== 34 || script[0] !== 0 || script[1] !== 0x20) {
    throw new Error("Input must be native P2WSH");
  }
}

function validateExpectedSpend(plan: ExpectedSpend): void {
  if (!Number.isInteger(plan.version) || plan.version < -0x80000000 || plan.version > 0x7fffffff) {
    throw new Error("Invalid transaction version");
  }
  if (!Number.isInteger(plan.locktime) || plan.locktime < 0 || plan.locktime > 0xffffffff) {
    throw new Error("Invalid locktime");
  }
  if (plan.inputs.length === 0 || plan.outputs.length === 0) throw new Error("Empty spend plan");
  if (plan.maxFeeSats < 0n || plan.maxFeeSats > MAX_MONEY) throw new Error("Invalid fee limit");
  const seen = new Set<string>();
  for (const input of plan.inputs) {
    if (
      !/^[0-9a-fA-F]{64}$/.test(input.txid) ||
      !Number.isInteger(input.vout) ||
      input.vout < 0 ||
      input.vout > 0xffffffff ||
      !Number.isInteger(input.sequence) ||
      input.sequence < 0 ||
      input.sequence > 0xffffffff ||
      input.sats <= 0n ||
      input.sats > MAX_MONEY
    )
      throw new Error("Invalid expected input");
    assertP2wsh(bytesFromHex(input.scriptPubKeyHex));
    const outpoint = `${input.txid.toLowerCase()}:${input.vout}`;
    if (seen.has(outpoint)) throw new Error("Duplicate expected input");
    seen.add(outpoint);
  }
  for (const output of plan.outputs) {
    if (
      output.sats < 0n ||
      output.sats > MAX_MONEY ||
      bytesFromHex(output.scriptPubKeyHex).length > 10_000
    ) {
      throw new Error("Invalid expected output");
    }
  }
}

function assertInputMap(entries: KeyValue[], expected: ExpectedSpendInput): void {
  let witnessUtxo: Uint8Array | undefined;
  let witnessScript: Uint8Array | undefined;
  let sighashAll = false;
  for (const entry of entries) {
    const type = entry.key[0];
    if (type === 0x01 && entry.key.length === 1) witnessUtxo = entry.value;
    else if (type === 0x03 && entry.key.length === 1) {
      if (!equalBytes(entry.value, Uint8Array.of(1, 0, 0, 0)))
        throw new Error("Only SIGHASH_ALL is allowed");
      sighashAll = true;
    } else if (type === 0x05 && entry.key.length === 1) witnessScript = entry.value;
    else if (
      type === 0x06 &&
      (entry.key.length === 34 || entry.key.length === 66) &&
      entry.value.length >= 4 &&
      (entry.value.length - 4) % 4 === 0
    ) {
      continue;
    } else throw new Error("Unsupported PSBT input field");
  }
  if (!witnessUtxo || !witnessScript || !sighashAll)
    throw new Error("Missing P2WSH input data or SIGHASH_ALL");
  if (witnessScript.length === 0 || witnessScript.length > 10_000)
    throw new Error("Invalid witness script length");
  const utxoReader = new Reader(witnessUtxo);
  const sats = utxoReader.readU64();
  const script = utxoReader.readBytes(utxoReader.readCompactSize(10_000));
  utxoReader.assertEnd();
  const expectedScript = bytesFromHex(expected.scriptPubKeyHex);
  assertP2wsh(script);
  if (sats !== expected.sats || !equalBytes(script, expectedScript))
    throw new Error("Input UTXO mismatch");
  if (!equalBytes(sha256(witnessScript), script.subarray(2)))
    throw new Error("Witness script mismatch");
}

export function inspectExitPsbtV0(base64: string, plan: ExpectedSpend): InspectedSpend {
  validateExpectedSpend(plan);
  const reader = new Reader(decodePsbtBase64(base64));
  if (!equalBytes(reader.readBytes(5), Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff))) {
    throw new Error("Invalid PSBT magic");
  }
  let unsigned: Uint8Array | undefined;
  for (const entry of readMap(reader)) {
    if (entry.key.length !== 1) throw new Error("Unsupported PSBT global field");
    if (entry.key[0] === 0x00) unsigned = entry.value;
    else if (entry.key[0] === 0xfb && !equalBytes(entry.value, Uint8Array.of(0, 0, 0, 0))) {
      throw new Error("Only PSBT v0 is supported");
    } else if (entry.key[0] !== 0xfb) throw new Error("Unsupported PSBT global field");
  }
  if (!unsigned) throw new Error("Missing unsigned transaction");
  const tx = parseTransaction(unsigned, true);
  if (
    tx.version !== plan.version ||
    tx.locktime !== plan.locktime ||
    tx.inputs.length !== plan.inputs.length ||
    tx.outputs.length !== plan.outputs.length
  ) {
    throw new Error("Transaction shape mismatch");
  }
  let inputSats = 0n;
  for (let i = 0; i < tx.inputs.length; i++) {
    const actual = tx.inputs[i];
    const expected = plan.inputs[i];
    if (
      actual.txid !== expected.txid.toLowerCase() ||
      actual.vout !== expected.vout ||
      actual.sequence !== expected.sequence
    )
      throw new Error("Unapproved spend input");
    assertInputMap(readMap(reader), expected);
    inputSats += expected.sats;
    if (inputSats > MAX_MONEY) throw new Error("Input total exceeds supply");
  }
  let outputSats = 0n;
  for (let i = 0; i < tx.outputs.length; i++) {
    const actual = tx.outputs[i];
    const expected = plan.outputs[i];
    if (
      actual.sats !== expected.sats ||
      actual.scriptPubKeyHex !== expected.scriptPubKeyHex.toLowerCase()
    ) {
      throw new Error("Unapproved spend output");
    }
    if (readMap(reader).length !== 0) throw new Error("Unsupported PSBT output field");
    outputSats += expected.sats;
  }
  reader.assertEnd();
  const feeSats = inputSats - outputSats;
  if (feeSats < 0n || feeSats > plan.maxFeeSats) throw new Error("Fee exceeds spend plan");
  return { txid: tx.txid, inputSats, outputSats, feeSats };
}
