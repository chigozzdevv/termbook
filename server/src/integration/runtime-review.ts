import { runtimeReviewSchema, type RuntimeReview } from "@termbook/schema";
import { runtimeReviewData, runtimeReviewSummary } from "@termbook/sdk";
import { keccak256, parseAbi, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { env } from "../config/env.js";

export async function approvedRuntimeReviews(): Promise<RuntimeReview[]> {
  const raw = process.env["TESTNET_RUNTIME_REVIEWS"];
  if (!raw) return [];
  if (env.monadChainId !== 10143 || process.env["NODE_ENV"] === "production" || raw.length > 32_768) throw new Error("integration-runtime-review-forbidden");
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new Error("integration-runtime-review-invalid"); }
  if (!Array.isArray(input) || input.length === 0 || input.length > 8) throw new Error("integration-runtime-review-invalid");
  const reviews = input.map((item: unknown) => runtimeReviewSchema.parse(item));
  if (new Set(reviews.map((r) => r.target.toLowerCase())).size !== reviews.length) throw new Error("integration-runtime-review-invalid");
  for (const review of reviews) {
    if (review.core.toLowerCase() !== env.core.toLowerCase() || review.approved_at > Math.floor(Date.now() / 1000) + 30
      || !env.adminWallets.includes(review.reviewer.toLowerCase())) throw new Error("integration-runtime-review-invalid");
    const signer = await recoverTypedDataAddress({ ...runtimeReviewData(review), signature: review.signature as Hex });
    if (signer.toLowerCase() !== review.reviewer.toLowerCase()) throw new Error("integration-runtime-review-signature-invalid");
  }
  return reviews;
}

export async function reviewedRuntime(address: Address, code: Hex) {
  const review = (await approvedRuntimeReviews()).find((r) => r.implementation.toLowerCase() === address.toLowerCase());
  if (!review) return null;
  if (review.expires_at <= Math.floor(Date.now() / 1000)) throw new Error("integration-runtime-review-expired");
  if (review.code_hash.toLowerCase() !== keccak256(code)) throw new Error("integration-runtime-review-code-changed");
  const summary = runtimeReviewSummary(review);
  return { abi: parseAbi(review.abi), address, matchId: summary.id, runtimeMatch: "testnet_runtime_review",
    compilerVersion: "unverified", contract: "reviewed runtime", sourceHash: summary.id, files: [],
    url: "", runtimeReview: summary, runtimeReviewTarget: review.target };
}
