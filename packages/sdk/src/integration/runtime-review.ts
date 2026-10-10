import { canonicalEvidence, type RuntimeReview } from "@termbook/schema";
import { hashTypedData, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";

export function runtimeReviewData(review: RuntimeReview) {
  const abiHash = keccak256(stringToHex(canonicalEvidence(parseAbi(review.abi))));
  return { domain: { name: "Termbook Testnet Runtime Review", version: "1", chainId: 10143, verifyingContract: review.core as Address },
    primaryType: "RuntimeReview", types: { RuntimeReview: [
      { name: "target", type: "address" }, { name: "implementation", type: "address" },
      { name: "codeHash", type: "bytes32" }, { name: "abiHash", type: "bytes32" },
      { name: "maximumInput", type: "uint256" }, { name: "approvedAt", type: "uint64" }, { name: "expiresAt", type: "uint64" },
    ] }, message: { target: review.target as Address, implementation: review.implementation as Address,
      codeHash: review.code_hash as Hex, abiHash, maximumInput: BigInt(review.maximum_input),
      approvedAt: BigInt(review.approved_at), expiresAt: BigInt(review.expires_at) } } as const;
}
export function runtimeReviewSummary(review: RuntimeReview) {
  return { id: hashTypedData(runtimeReviewData(review)), expires_at: review.expires_at, maximum_input: review.maximum_input };
}
