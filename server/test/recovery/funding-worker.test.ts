import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { recoveryRepo } from "../../src/recovery/recovery.repo.js";
import { runRecoveryWorker } from "../../src/recovery/recovery.worker.js";
import { SettlementModel } from "../../src/settlement/settlement.model.js";
import { logger } from "../../src/logging/logger.js";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData } from "viem";
import { recoveryFundingPlan, recoveryFundingTypedData } from "../../src/recovery/recovery.plan.js";

const mocks = vi.hoisted(() => ({
  source: { getChainId: vi.fn(), getBlock: vi.fn(), readContract: vi.fn() },
  monad: { getChainId: vi.fn(), getBlock: vi.fn(), readContract: vi.fn() },
  wallet: vi.fn(),
}));

vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(),
  createPublicClient: vi.fn(() => mocks.source),
  createWalletClient: mocks.wallet,
}));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => mocks.monad }));
vi.mock("@defuse-protocol/one-click-sdk-typescript", async (load) => ({
  ...await load<typeof import("@defuse-protocol/one-click-sdk-typescript")>(),
  verifyQuoteSignature: vi.fn(() => true),
  quoteHash: vi.fn(() => "signed-quote"),
}));

const address = (digit: string) => `0x${digit.repeat(40)}`;
const id = (digit: string) => `0x${digit.repeat(64)}`;
const original = {
  settlementFactory: env.settlementFactory, core: env.core,
  monadChainId: env.monadChainId, auroraRoutes: env.auroraRoutes, auroraApiKey: env.auroraApiKey,
  rpcs: process.env["RECOVERY_SOURCE_RPCS"], signer: process.env["RECOVERY_ROUTE_SIGNER_KEY"],
  riskSigner: process.env["RECOVERY_RISK_SIGNER"],
  funder: process.env["RECOVERY_FUNDING_KEY"],
};

afterEach(() => {
  env.settlementFactory = original.settlementFactory;
  env.core = original.core;
  env.monadChainId = original.monadChainId;
  env.auroraRoutes = original.auroraRoutes;
  env.auroraApiKey = original.auroraApiKey;
  for (const [key, value] of [
    ["RECOVERY_SOURCE_RPCS", original.rpcs],
    ["RECOVERY_ROUTE_SIGNER_KEY", original.signer],
    ["RECOVERY_RISK_SIGNER", original.riskSigner],
    ["RECOVERY_FUNDING_KEY", original.funder],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  mocks.source.getChainId.mockReset();
  mocks.source.getBlock.mockReset();
  mocks.monad.getChainId.mockReset();
  mocks.monad.getBlock.mockReset();
  mocks.monad.readContract.mockReset();
  mocks.wallet.mockReset();
});

describe("recovery funding worker", () => {
  it("never funds when the finalized factory digest differs from the stored operation", async () => {
    const operationId = id("1");
    const inbox = address("2");
    const recoveryVault = address("3");
    const sourceAsset = address("4");
    const vault = address("5");
    const token = address("6");
    const routeId = id("7");
    const routeVersion = `0x${"0".repeat(63)}1`;
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const operation = {
      operationId, registrationTxHash: id("a"), kind: "recovery", payer: address("8"), nonce: "1",
      sourceChain: 1, sourceAsset, vault, token, creditId: id("9"),
      maxAmountIn: "100", minAmountOut: "80", maxReceived: "120", deadline,
      sourceRefundRecipient: recoveryVault, monadRefundRecipient: address("a"), refundRecipient: address("a"),
      routeId, routeVersion, inbox,
      quote: {
        quoteRequest: {
          dry: false, swapType: "EXACT_INPUT", originAsset: "eth:1:erc20:weth", destinationAsset: "monad:erc20:usdc",
          depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN",
          amount: "100", recipient: inbox, refundTo: recoveryVault, slippageTolerance: 50,
        },
        quote: { depositAddress: address("b"), amountIn: "100", amountOut: "100", minAmountOut: "80", deadline: new Date((deadline - 60) * 1000).toISOString() },
      },
    };
    env.settlementFactory = address("c");
    env.core = address("d");
    env.monadChainId = 143;
    env.auroraApiKey = "test-key";
    env.auroraRoutes = JSON.stringify([{
      routeId, routeVersion, kind: "recovery", sourceChain: 1, sourceAsset,
      sourceAssetId: "eth:1:erc20:weth", destinationAssetId: "monad:erc20:usdc",
      vault, token, maxAmountIn: "100", slippageBps: 50, recoveryVault,
    }]);
    process.env["RECOVERY_SOURCE_RPCS"] = JSON.stringify({ 1: "http://127.0.0.1:8545" });
    process.env["RECOVERY_ROUTE_SIGNER_KEY"] = `0x${"1".repeat(64)}`;
    const risk = privateKeyToAccount(`0x${"3".repeat(64)}`);
    process.env["RECOVERY_RISK_SIGNER"] = risk.address;
    process.env["RECOVERY_FUNDING_KEY"] = `0x${"2".repeat(64)}`;

    vi.spyOn(SettlementModel, "aggregate").mockResolvedValue([operation]);
    vi.spyOn(recoveryRepo, "claim").mockResolvedValue({ token: "lease", state: "pending" });
    const approval = vi.spyOn(recoveryRepo, "riskApproval").mockResolvedValue(null);
    const released = vi.spyOn(recoveryRepo, "release").mockResolvedValue();
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    mocks.source.getChainId.mockResolvedValue(1);
    mocks.source.getBlock.mockResolvedValue({ number: 100n });
    mocks.monad.getChainId.mockResolvedValue(143);
    mocks.monad.getBlock.mockResolvedValue({ number: 100n });
    mocks.monad.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "inboxOf") return inbox;
      if (functionName === "operationDigestOf") return id("f");
      if (functionName === "routeRegistry") return address("e");
      return address("0");
    });

    expect(await runRecoveryWorker()).toBe(0);
    expect(mocks.source.getChainId).not.toHaveBeenCalled();
    const plan = recoveryFundingPlan(operation);
    const typedData = recoveryFundingTypedData(plan.operation, plan.funding);
    approval.mockResolvedValue({
      creditId: operation.creditId, fundingDigest: hashTypedData(typedData), riskSigner: risk.address,
      signature: await risk.signTypedData(typedData), deadline: Number(plan.funding.deadline),
    } as never);
    expect(await runRecoveryWorker()).toBe(0);
    expect(released).toHaveBeenCalledWith(operationId, "lease");
    expect(mocks.wallet).not.toHaveBeenCalled();
  });
});
