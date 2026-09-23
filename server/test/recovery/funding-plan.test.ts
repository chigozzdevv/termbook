import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashTypedData, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../src/config/env.js";
import { recoveryFundingPlan, recoveryFundingTypedData, verifiedRiskSignature } from "../../src/recovery/recovery.plan.js";

vi.mock("@defuse-protocol/one-click-sdk-typescript", async (load) => ({
  ...await load<typeof import("@defuse-protocol/one-click-sdk-typescript")>(),
  verifyQuoteSignature: vi.fn(() => true),
  quoteHash: vi.fn(() => "signed-quote"),
}));

const factory = `0x${"a".repeat(40)}`;
const recoveryVault = `0x${"b".repeat(40)}`;
const inbox = `0x${"c".repeat(40)}`;
const deposit = `0x${"d".repeat(40)}`;
const creditId = `0x${"1".repeat(64)}`;
const operationId = `0x${"2".repeat(64)}`;
const now = Date.now();
const deadline = Math.floor((now + 10 * 60_000) / 1000);
const quoteDeadline = new Date(now + 5 * 60_000).toISOString();

function candidate() {
  return {
    operationId, registrationTxHash: `0x${"6".repeat(64)}`,
    kind: "recovery", payer: `0x${"1".repeat(40)}`, nonce: "42",
    sourceChain: 1, sourceAsset: `0x${"2".repeat(40)}`,
    vault: `0x${"3".repeat(40)}`, token: `0x${"4".repeat(40)}`,
    creditId, maxAmountIn: "100", minAmountOut: "80", maxReceived: "120",
    deadline, sourceRefundRecipient: recoveryVault,
    monadRefundRecipient: `0x${"5".repeat(40)}`, refundRecipient: `0x${"5".repeat(40)}`,
    routeId: `0x${"3".repeat(64)}`, routeVersion: `0x${"0".repeat(63)}1`, inbox,
    quote: {
      quoteRequest: {
        dry: false, swapType: "EXACT_INPUT", originAsset: "eth:1:erc20:weth", destinationAsset: "monad:erc20:usdc",
        depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN",
        amount: "100", recipient: inbox, refundTo: recoveryVault, slippageTolerance: 50,
      },
      quote: { depositAddress: deposit, amountIn: "100", amountOut: "110", minAmountOut: "80", deadline: quoteDeadline },
    },
  };
}

const originalFactory = env.settlementFactory;
const originalChain = env.monadChainId;

beforeEach(() => {
  env.settlementFactory = factory;
  env.monadChainId = 143;
});

afterEach(() => {
  env.settlementFactory = originalFactory;
  env.monadChainId = originalChain;
});

describe("source recovery funding plan", () => {
  it("binds funding to the authorized credit, inbox, quote and source refund vault", () => {
    const plan = recoveryFundingPlan(candidate());
    expect(plan.record).toMatchObject({
      operationId, creditId, sourceChain: 1, recoveryVault, inbox,
      depositAddress: deposit, amount: "100", nonce: "42",
      quoteHash: keccak256(stringToHex("signed-quote")),
    });
    expect(plan.funding).toMatchObject({ creditId, operationId, inbox, depositAddress: deposit, amount: 100n, nonce: 42n });
    expect(plan.digest).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("rejects quote redirection, source refund changes and output outside the inbox bounds", () => {
    const redirected = candidate();
    redirected.quote.quoteRequest.recipient = deposit;
    expect(() => recoveryFundingPlan(redirected)).toThrow("recovery-quote-invalid");
    const refundChanged = candidate();
    refundChanged.quote.quoteRequest.refundTo = deposit;
    expect(() => recoveryFundingPlan(refundChanged)).toThrow("recovery-quote-invalid");
    const excessive = candidate();
    excessive.quote.quote.amountOut = "121";
    expect(() => recoveryFundingPlan(excessive)).toThrow("recovery-quote-invalid");
    const partialInput = candidate();
    partialInput.quote.quote.amountIn = "99";
    expect(() => recoveryFundingPlan(partialInput)).toThrow("recovery-quote-invalid");
  });

  it("keeps an expired quote readable for submitted transaction reconciliation", () => {
    const expired = candidate();
    expired.deadline = Math.floor(Date.now() / 1000) - 10;
    expired.quote.quote.deadline = new Date(Date.now() - 20_000).toISOString();
    expect(recoveryFundingPlan(expired).funding.operationId).toBe(operationId);
  });

  it("accepts an external risk approval only for the exact quote and funding terms", async () => {
    const signer = privateKeyToAccount(`0x${"3".repeat(64)}`);
    const { operation, funding } = recoveryFundingPlan(candidate());
    const typedData = recoveryFundingTypedData(operation, funding);
    const signature = await signer.signTypedData(typedData);
    const approval = {
      creditId, fundingDigest: hashTypedData(typedData), riskSigner: signer.address,
      signature, deadline: Number(funding.deadline),
    };
    await expect(verifiedRiskSignature(operation, funding, approval, signer.address)).resolves.toBe(signature);
    await expect(verifiedRiskSignature(operation, { ...funding, depositAddress: `0x${"e".repeat(40)}` }, approval, signer.address))
      .rejects.toThrow("recovery-risk-approval-invalid");
    await expect(verifiedRiskSignature(operation, funding, { ...approval, signature: await privateKeyToAccount(`0x${"4".repeat(64)}`).signTypedData(typedData) }, signer.address))
      .rejects.toThrow("recovery-risk-approval-invalid");
  });
});
