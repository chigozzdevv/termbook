import { afterEach, describe, expect, it, vi } from "vitest";
import { hashTypedData } from "viem";
import { Settlement } from "../src/settlement/settlement.js";
import type { TermbookClient } from "../src/client/client.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;

afterEach(() => vi.unstubAllGlobals());

describe("external recovery risk approval", () => {
  it("signs the exact server-derived funding plan with the risk wallet", async () => {
    const riskSigner = address("a");
    const creditId = id("1");
    const operationId = id("2");
    const typedData = {
      domain: { name: "Termbook", version: "1", chainId: 1, verifyingContract: address("b") },
      primaryType: "RecoveryFunding",
      types: { RecoveryFunding: [
        { name: "creditId", type: "bytes32" }, { name: "operationId", type: "bytes32" },
        { name: "inbox", type: "address" }, { name: "depositAddress", type: "address" },
        { name: "amount", type: "uint256" }, { name: "quoteHash", type: "bytes32" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        { name: "monadChain", type: "uint256" }, { name: "asset", type: "address" },
      ] },
      message: {
        creditId, operationId, inbox: address("c"), depositAddress: address("d"),
        amount: "100", quoteHash: id("3"), nonce: "1", deadline: "9999999999",
        monadChain: "143", asset: address("e"),
      },
    } as const;
    const plan = { operationId, riskSigner, fundingDigest: hashTypedData(typedData as never), typedData };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => plan });
    vi.stubGlobal("fetch", fetchMock);
    const sign = vi.fn().mockResolvedValue(`0x${"f".repeat(130)}`);
    const post = vi.fn().mockResolvedValue({ operationId, fundingDigest: plan.fundingDigest, state: "approved" });
    const client = {
      ready: async () => {},
      config: { apiBase: "https://termbook.example" },
      signer: { address: () => riskSigner, sign }, authenticatedPost: post,
    } as unknown as TermbookClient;
    const settlement = new Settlement(client);

    expect(await settlement.approveRecoveryRisk(creditId, operationId)).toMatchObject({ state: "approved" });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://termbook.example/recovery/risk-approval-plan?creditId=${creditId}&operationId=${operationId}`,
      { headers: {} },
    );
    expect(sign).toHaveBeenCalledWith(typedData);
    expect(post).toHaveBeenCalledWith("/recovery/risk-approval", {
      creditId, operationId, signature: `0x${"f".repeat(130)}`,
    });

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...plan, fundingDigest: id("4") }) });
    await expect(settlement.approveRecoveryRisk(creditId, operationId)).rejects.toThrow("recovery-risk-plan-invalid");
    expect(sign).toHaveBeenCalledTimes(1);
  });
});
