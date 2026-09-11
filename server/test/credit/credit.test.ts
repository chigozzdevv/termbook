import { describe, expect, it } from "vitest";
import { isReorg } from "../../src/chain/chain.events.js";
import { jobId } from "../../src/queue/queue.client.js";
import { fetchProof } from "../../src/chain/source.client.js";

describe("events", () => {
  it("detects reorg", () => {
    expect(isReorg({ name: "x", block: 5, blockHash: "0x1", tx: "0xa", data: {} }, { name: "x", block: 5, blockHash: "0x2", tx: "0xb", data: {} })).toBe(
      true,
    );
    expect(isReorg({ name: "x", block: 5, blockHash: "0x1", tx: "0xa", data: {} }, { name: "x", block: 5, blockHash: "0x1", tx: "0xa", data: {} })).toBe(
      false,
    );
  });
});

describe("jobs", () => {
  it("derives stable id", () => {
    const a = jobId({ kind: "settle-finalize", payload: { operationId: "0x1" } });
    expect(a).toBe("settle-finalize:0x1");
  });

  it("rejects bad proof input", async () => {
    await expect(fetchProof("notaurl", "0x1")).rejects.toThrow();
  });
});
