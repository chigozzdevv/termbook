import { describe, expect, it } from "vitest";
// @ts-expect-error Deployment scripts run directly in Node.
import { verifySettledCredits } from "../../../scripts/testnet-replacement.mjs";

const previous = { addresses: { 10143: { TermbookCore: "core" } } };
const evidence = { core: "core", observations: [{ creditId: "credit", account: "account", lockId: "lock" }] };
const credit = { facility: 6, debt: 0n, collateralReturned: true, account: "account", lockId: "lock", collateralVault: "vault" };
const read = (overrides: Record<string, unknown> = {}) => async (_chain: number, _name: string, _address: string, method: string) => {
  const responses = { acceptedCredits: 1n, creditDetails: credit, locks: [0, 0, 0n], released: true, ...overrides };
  return responses[method as keyof typeof responses];
};

describe("testnet replacement custody gates", () => {
  it("accepts settled historical credits without treating the lifetime counter as active debt", async () => {
    await expect(verifySettledCredits(previous, evidence, read())).resolves.toHaveLength(1);
  });
  it("rejects an incomplete inventory", async () => {
    await expect(verifySettledCredits(previous, evidence, read({ acceptedCredits: 2n }))).rejects.toThrow("incomplete");
  });
  it.each([
    { ...credit, facility: 4 }, { ...credit, debt: 1n }, { ...credit, collateralReturned: false },
  ])("rejects unresolved credit state", async (creditDetails) => {
    await expect(verifySettledCredits(previous, evidence, read({ creditDetails }))).rejects.toThrow("settlement");
  });
  it("rejects remaining source custody and account control", async () => {
    await expect(verifySettledCredits(previous, evidence, read({ locks: [0, 0, 1n] }))).rejects.toThrow("custody");
    await expect(verifySettledCredits(previous, evidence, read({ released: false }))).rejects.toThrow("custody");
  });
  it("permits an aborted unused account only after collateral return", async () => {
    await expect(verifySettledCredits(previous, evidence, read({ creditDetails: { ...credit, facility: 7 }, released: false }))).resolves.toHaveLength(1);
  });
});
