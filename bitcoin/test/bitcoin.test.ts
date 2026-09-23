import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  inspectExitPsbtV0,
  inspectFundingTransaction,
  parseTransaction,
  type ExpectedSpend,
} from "../src/index.js";

const key1 = Buffer.from(
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "hex",
);
const key2 = Buffer.from("02c6047f9441ed7d6d3045406e95c07cd85a106171b725377876fa28a2ea213", "hex");
const witnessScript = Buffer.concat([
  Buffer.from([0x52, 0x21]),
  key1,
  Buffer.from([0x21]),
  key2,
  Buffer.from([0x52, 0xae]),
]);
const vaultScript = Buffer.concat([
  Buffer.from([0, 0x20]),
  createHash("sha256").update(witnessScript).digest(),
]);
const recipientScript = Buffer.from(`0014${"66".repeat(20)}`, "hex");
const changeScript = vaultScript;
const txid = "11".repeat(32);

function compact(value: number): Buffer {
  if (value < 0xfd) return Buffer.from([value]);
  const out = Buffer.alloc(3);
  out[0] = 0xfd;
  out.writeUInt16LE(value, 1);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function output(sats: bigint, script: Buffer): Buffer {
  return Buffer.concat([u64(sats), compact(script.length), script]);
}

function transaction(outputs: Buffer[], witness = false, inputCount = 1): Buffer {
  const inputs = Array.from({ length: inputCount }, (_, index) =>
    Buffer.concat([
      Buffer.from(txid, "hex").reverse(),
      u32(index),
      Buffer.from([0]),
      u32(0xffffffff),
    ]),
  );
  const prefix = Buffer.concat([
    u32(2),
    compact(inputs.length),
    ...inputs,
    compact(outputs.length),
    ...outputs,
  ]);
  if (!witness) return Buffer.concat([prefix, u32(0)]);
  return Buffer.concat([
    u32(2),
    Buffer.from([0, 1]),
    prefix.subarray(4),
    ...inputs.map(() => Buffer.from([1, 1, 1])),
    u32(0),
  ]);
}

function entry(key: Buffer, value: Buffer): Buffer {
  return Buffer.concat([compact(key.length), key, compact(value.length), value]);
}

interface PsbtOptions {
  extraInputFields?: Buffer[];
  outputMaps?: Buffer[];
  extraGlobals?: Buffer[];
  witnessScript?: Buffer;
  sighash?: Buffer | null;
}

function psbt(unsigned: Buffer, options: PsbtOptions = {}): string {
  const parsed = parseTransaction(unsigned);
  const witnessUtxo = output(100_000n, vaultScript);
  const inputMap = Buffer.concat([
    entry(Buffer.from([1]), witnessUtxo),
    entry(Buffer.from([5]), options.witnessScript ?? witnessScript),
    ...(options.sighash === null ? [] : [entry(Buffer.from([3]), options.sighash ?? u32(1))]),
    ...(options.extraInputFields ?? []),
    Buffer.from([0]),
  ]);
  const maps = options.outputMaps ?? parsed.outputs.map(() => Buffer.from([0]));
  return Buffer.concat([
    Buffer.from("70736274ff", "hex"),
    entry(Buffer.from([0]), unsigned),
    ...(options.extraGlobals ?? []),
    Buffer.from([0]),
    ...parsed.inputs.map(() => inputMap),
    ...maps,
  ]).toString("base64");
}

function plan(): ExpectedSpend {
  return {
    version: 2,
    locktime: 0,
    inputs: [
      {
        txid,
        vout: 0,
        sequence: 0xffffffff,
        sats: 100_000n,
        scriptPubKeyHex: vaultScript.toString("hex"),
      },
    ],
    outputs: [
      { sats: 49_000n, scriptPubKeyHex: recipientScript.toString("hex") },
      { sats: 50_000n, scriptPubKeyHex: changeScript.toString("hex") },
    ],
    maxFeeSats: 1_000n,
  };
}

describe("native BTC funding observation", () => {
  it("finds one exact P2WSH lock and derives txid without witness data", () => {
    const outputs = [output(120_000n, vaultScript), output(1_000n, recipientScript)];
    const legacy = transaction(outputs);
    const segwit = transaction(outputs, true);
    const observation = inspectFundingTransaction(segwit.toString("hex"), {
      scriptPubKeyHex: vaultScript.toString("hex"),
      minSats: 100_000n,
    });
    expect(observation).toMatchObject({
      txid: parseTransaction(legacy).txid,
      vout: 0,
      sats: 120_000n,
      confirmation: "unverified",
    });
  });

  it("rejects underfunded or ambiguous lock outputs", () => {
    const expectation = { scriptPubKeyHex: vaultScript.toString("hex"), minSats: 100_000n };
    expect(() =>
      inspectFundingTransaction(
        transaction([output(99_999n, vaultScript)]).toString("hex"),
        expectation,
      ),
    ).toThrow("below minimum");
    expect(() =>
      inspectFundingTransaction(
        transaction([output(100_000n, vaultScript), output(100_000n, vaultScript)]).toString("hex"),
        expectation,
      ),
    ).toThrow("one matching lock output");
  });

  it("rejects truncated and noncanonical transactions", () => {
    const raw = transaction([output(100_000n, vaultScript)]);
    expect(() => parseTransaction(raw.subarray(0, raw.length - 1))).toThrow();
    const noncanonical = Buffer.concat([
      raw.subarray(0, 4),
      Buffer.from([0xfd, 1, 0]),
      raw.subarray(5),
    ]);
    expect(() => parseTransaction(noncanonical)).toThrow("Noncanonical CompactSize");
  });
});

describe("native BTC PSBT spend policy", () => {
  it("accepts a v0 P2WSH PSBT matching every input and output and its fee cap", () => {
    const expected = plan();
    const unsigned = transaction([output(49_000n, recipientScript), output(50_000n, changeScript)]);
    expect(inspectExitPsbtV0(psbt(unsigned), expected)).toMatchObject({
      feeSats: 1_000n,
      inputSats: 100_000n,
      outputSats: 99_000n,
    });
  });

  it("rejects changed destination, fee, inputs, and UTXO facts", () => {
    const expected = plan();
    const wrongRecipient = Buffer.from(`0014${"77".repeat(20)}`, "hex");
    expect(() =>
      inspectExitPsbtV0(
        psbt(transaction([output(49_000n, wrongRecipient), output(50_000n, changeScript)])),
        expected,
      ),
    ).toThrow("Unapproved spend output");
    expect(() =>
      inspectExitPsbtV0(
        psbt(transaction([output(48_999n, recipientScript), output(50_000n, changeScript)])),
        expected,
      ),
    ).toThrow("Unapproved spend output");
    expect(() =>
      inspectExitPsbtV0(
        psbt(
          transaction([output(49_000n, recipientScript), output(50_000n, changeScript)], false, 2),
        ),
        expected,
      ),
    ).toThrow("Transaction shape mismatch");
    expect(() =>
      inspectExitPsbtV0(
        psbt(transaction([output(49_000n, recipientScript), output(50_000n, changeScript)])),
        {
          ...expected,
          inputs: [{ ...expected.inputs[0], sats: 99_999n }],
        },
      ),
    ).toThrow("Input UTXO mismatch");
    expect(() =>
      inspectExitPsbtV0(
        psbt(transaction([output(49_000n, recipientScript), output(50_000n, changeScript)])),
        {
          ...expected,
          maxFeeSats: 999n,
        },
      ),
    ).toThrow("Fee exceeds spend plan");
  });

  it("rejects malleable signing requests and unsupported PSBT fields", () => {
    const unsigned = transaction([output(49_000n, recipientScript), output(50_000n, changeScript)]);
    expect(() => inspectExitPsbtV0(psbt(unsigned, { sighash: u32(0x81) }), plan())).toThrow(
      "Only SIGHASH_ALL",
    );
    expect(() => inspectExitPsbtV0(psbt(unsigned, { sighash: null }), plan())).toThrow(
      "Missing P2WSH input data or SIGHASH_ALL",
    );
    expect(() =>
      inspectExitPsbtV0(
        psbt(unsigned, { extraInputFields: [entry(Buffer.from([7]), Buffer.alloc(0))] }),
        plan(),
      ),
    ).toThrow("Unsupported PSBT input field");
    expect(() =>
      inspectExitPsbtV0(
        psbt(unsigned, { extraGlobals: [entry(Buffer.from([0xfb]), u32(2))] }),
        plan(),
      ),
    ).toThrow("Only PSBT v0");
    expect(() =>
      inspectExitPsbtV0(
        psbt(unsigned, {
          extraInputFields: [entry(Buffer.from([1]), output(100_000n, vaultScript))],
        }),
        plan(),
      ),
    ).toThrow("Duplicate PSBT key");
  });

  it("rejects an unauthorized output map or witness script", () => {
    const unsigned = transaction([output(49_000n, recipientScript), output(50_000n, changeScript)]);
    const badOutputMap = Buffer.concat([
      entry(Buffer.from([2]), Buffer.from([1])),
      Buffer.from([0]),
    ]);
    expect(() =>
      inspectExitPsbtV0(psbt(unsigned, { outputMaps: [badOutputMap, Buffer.from([0])] }), plan()),
    ).toThrow("Unsupported PSBT output field");
    expect(() =>
      inspectExitPsbtV0(psbt(unsigned, { witnessScript: Buffer.from([0x51]) }), plan()),
    ).toThrow("Witness script mismatch");
  });
});
