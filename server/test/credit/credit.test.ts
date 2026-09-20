import { describe, expect, it } from "vitest";
import { isReorg } from "../../src/chain/chain.events.js";
import { jobId } from "../../src/queue/queue.client.js";
import { fetchProof } from "../../src/chain/source.client.js";
import { deriveOperationId } from "../../src/settlement/operation-id.js";
import { operationId } from "../../../packages/sdk/src/settlement/operation.js";

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

describe("settlement operation identity", () => {
  it("matches the SDK operation id", () => {
    const input = {
      kind: "repay" as const,
      payer: "0x0000000000000000000000000000000000000001",
      nonce: 7n,
      chainId: 1,
      creditId: "0x0000000000000000000000000000000000000000000000000000000000000002",
      routeVersion: "0x0000000000000000000000000000000000000000000000000000000000000003",
      sourceAsset: "0x0000000000000000000000000000000000000004",
      vault: "0x0000000000000000000000000000000000000005",
    };
    expect(deriveOperationId(input)).toBe(operationId({ ...input, asset: input.sourceAsset }));
    expect(deriveOperationId({ ...input, nonce: 8n })).not.toBe(deriveOperationId(input));
  });
});
