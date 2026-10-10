import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runtimeReviewData, runtimeReviewSummary } from "@termbook/sdk";
import type { RuntimeReview } from "@termbook/schema";
import { env } from "../../src/config/env.js";
import { approvedRuntimeReviews, reviewedRuntime } from "../../src/integration/runtime-review.js";
import { importVerifiedSource } from "../../src/integration/integration.source.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const core = `0x${"22".repeat(20)}` as const;
const target = `0x${"33".repeat(20)}` as const;
const implementation = `0x${"44".repeat(20)}` as const;
const previous = { monadChainId: env.monadChainId, core: env.core, adminWallets: env.adminWallets };
let review: RuntimeReview;
async function configure(value = review) {
  value.signature = await account.signTypedData(runtimeReviewData(value));
  vi.stubEnv("TESTNET_RUNTIME_REVIEWS", JSON.stringify([value]));
}
beforeEach(async () => {
  env.monadChainId = 10143; env.core = core; env.adminWallets = [account.address.toLowerCase()];
  vi.stubEnv("NODE_ENV", "test");
  const now = Math.floor(Date.now() / 1000);
  review = { chain_id: 10143, core, target, implementation, code_hash: keccak256("0x1234"),
    abi: ["function trade(uint256) payable returns(uint256)"], maximum_input: "100000",
    approved_at: now - 10, expires_at: now + 60, reviewer: account.address, signature: `0x${"00".repeat(65)}` };
  await configure();
});
afterEach(() => { Object.assign(env, previous); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("testnet runtime admission", () => {
  it("returns a clearly labelled runtime review and checks every permitted selector", async () => {
    const expected = runtimeReviewSummary(review);
    const source = await reviewedRuntime(implementation, "0x1234");
    expect(source).toMatchObject({ sourceHash: expected.id, runtimeMatch: "testnet_runtime_review", runtimeReview: expected, files: [] });
    await expect(importVerifiedSource(10143, implementation, "0x1234", toFunctionSelector("trade(uint256)"), true)).resolves.toMatchObject({ runtimeReview: expected });
    await expect(importVerifiedSource(10143, implementation, "0x1234", toFunctionSelector("withdraw(uint256)"))).rejects.toThrow("integration-source-selector-mismatch");
    expect(await reviewedRuntime(target, "0x1234")).toBeNull();
  });
  it("rejects mainnet, production, a different Core and an unauthorized signer", async () => {
    env.monadChainId = 143;
    await expect(approvedRuntimeReviews()).rejects.toThrow("integration-runtime-review-forbidden");
    env.monadChainId = 10143; vi.stubEnv("NODE_ENV", "production");
    await expect(approvedRuntimeReviews()).rejects.toThrow("integration-runtime-review-forbidden");
    vi.stubEnv("NODE_ENV", "test"); env.core = target;
    await expect(approvedRuntimeReviews()).rejects.toThrow("integration-runtime-review-invalid");
    env.core = core; env.adminWallets = [];
    await expect(approvedRuntimeReviews()).rejects.toThrow("integration-runtime-review-invalid");
  });
  it("rejects changed code and expiry even after a successful request", async () => {
    await reviewedRuntime(implementation, "0x1234");
    await expect(reviewedRuntime(implementation, "0x1235")).rejects.toThrow("integration-runtime-review-code-changed");
    review.expires_at = review.approved_at + 1; await configure();
    await expect(reviewedRuntime(implementation, "0x1234")).rejects.toThrow("integration-runtime-review-expired");
  });
  it("binds the ABI, trade cap and proxy to the signature", async () => {
    for (const change of [{ abi: ["function withdraw(uint256)"] }, { maximum_input: "10000" }, { target: core }]) {
      vi.stubEnv("TESTNET_RUNTIME_REVIEWS", JSON.stringify([{ ...review, ...change }]));
      await expect(approvedRuntimeReviews()).rejects.toThrow("integration-runtime-review-signature-invalid");
    }
  });
});
