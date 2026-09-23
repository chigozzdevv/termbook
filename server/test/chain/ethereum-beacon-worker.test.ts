import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { admissibleBeaconUpdate } from "../../src/chain/ethereum-beacon.worker.js";
import type { prepareBeaconUpdate } from "../../src/chain/ethereum-beacon-proof.js";

const root = (byte: string) => `0x${byte.repeat(32)}` as Hex;
const zero = root("00");
const period = 8192n;

function prepared(overrides: Partial<ReturnType<typeof prepareBeaconUpdate>> = {}) {
  return {
    calldata: "0x1234" as Hex,
    finalizedBeaconRoot: root("aa"),
    executionBlockHash: root("bb"),
    finalizedSlot: period + 12n,
    attestedSlot: period + 13n,
    nextCommitteeRoot: zero,
    signerCommitteeRoot: root("11"),
    signatureSlot: period + 14n,
    ...overrides,
  };
}

describe("Ethereum Beacon relay admission", () => {
  const stored = { slot: period + 10n, currentRoot: root("11"), nextRoot: zero };

  it("accepts a newer update signed by the stored committee", () => {
    expect(admissibleBeaconUpdate(prepared(), stored)).toBe(true);
  });

  it("permits a committee-only update only while the next committee is missing", () => {
    const learning = prepared({ finalizedSlot: stored.slot, nextCommitteeRoot: root("22") });
    expect(admissibleBeaconUpdate(learning, stored)).toBe(true);
    expect(admissibleBeaconUpdate(learning, { ...stored, nextRoot: root("22") })).toBe(false);
  });

  it("rejects skipped periods, unknown signers, and stale finality", () => {
    expect(admissibleBeaconUpdate(prepared({ signatureSlot: period * 3n }), stored)).toBe(false);
    expect(admissibleBeaconUpdate(prepared({ signerCommitteeRoot: root("33") }), stored)).toBe(false);
    expect(admissibleBeaconUpdate(prepared({ finalizedSlot: stored.slot }), stored)).toBe(false);
    expect(admissibleBeaconUpdate(prepared({ finalizedSlot: period * 3n }), stored)).toBe(false);
  });
});
