import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { assertKeeperFunding, assertSignedKeeperFunding } from "../../src/chain/keeper-funding.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
describe("keeper gas funding", () => {
  it("requires the full EIP-1559 fee cap plus value rather than the expected fee", async () => {
    const getBalance = vi.fn(async () => 150n);
    const client = { getBalance } as never;
    await expect(assertKeeperFunding(client, account.address, { gas: 10n, maxFeePerGas: 20n, value: 3n }))
      .rejects.toThrow("requiredWei=203 balanceWei=150");
    getBalance.mockResolvedValue(203n);
    await expect(assertKeeperFunding(client, account.address, { gas: 10n, maxFeePerGas: 20n, value: 3n })).resolves.toBeUndefined();
    expect(getBalance).toHaveBeenCalledWith({ address: account.address, blockTag: "latest" });
  });

  it.each(["legacy", "eip1559"] as const)("recovers the signer and fee obligation from a journaled %s transaction", async (type) => {
    const fees = type === "legacy" ? { gasPrice: 20n } : { maxFeePerGas: 20n, maxPriorityFeePerGas: 2n };
    const raw = await account.signTransaction({ chainId: 10143, type, nonce: 1, to: account.address, gas: 10n, value: 3n, ...fees });
    const getBalance = vi.fn(async () => 202n);
    await expect(assertSignedKeeperFunding({ getBalance } as never, raw)).rejects.toThrow("keeper-funding-insufficient");
    expect(getBalance).toHaveBeenCalledWith({ address: account.address, blockTag: "latest" });
  });

  it("rejects missing or invalid fee caps", async () => {
    const getBalance = vi.fn();
    for (const request of [{ gas: 10n }, { gas: 0n, gasPrice: 1n }, { gas: 10n, maxFeePerGas: -1n }]) {
      await expect(assertKeeperFunding({ getBalance } as never, account.address, request)).rejects.toThrow("keeper-fee-request-invalid");
    }
    expect(getBalance).not.toHaveBeenCalled();
  });
});
