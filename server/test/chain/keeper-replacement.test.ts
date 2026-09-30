import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { replaceKeeperTransaction } from "../../src/chain/keeper-replacement.js";
import { keeperRepo } from "../../src/chain/keeper.repo.js";
vi.mock("../../src/chain/keeper.repo.js", () => ({ keeperRepo: {
  claim: vi.fn(), release: vi.fn(), replaced: vi.fn(),
} }));
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const key = `143:${account.address.toLowerCase()}`;
const client = { getChainId: async () => 143 } as never;
const transaction = { chainId: 143, type: "eip1559" as const, nonce: 7,
  to: account.address, data: "0xaabbccdd" as const, value: 0n, gas: 40000n,
  maxFeePerGas: 100n, maxPriorityFeePerGas: 10n };
let raw: `0x${string}`;
beforeEach(async () => {
  vi.resetAllMocks();
  raw = await account.signTransaction(transaction);
  vi.mocked(keeperRepo.claim).mockResolvedValue({ lease: "lease", pending: {
    id: "operation", raw, hash: keccak256(raw), nonce: 7, to: account.address, data: transaction.data,
  } });
});
describe("keeper fee replacement", () => {
  it("persists a signed fee bump at the same nonce while retaining the original candidate", async () => {
    const replacement = await account.signTransaction({ ...transaction, maxFeePerGas: 120n, maxPriorityFeePerGas: 12n });
    expect(await replaceKeeperTransaction(client, key, replacement)).toBe(keccak256(replacement));
    expect(keeperRepo.replaced).toHaveBeenCalledWith(key, "lease", keccak256(raw), expect.objectContaining({
      id: "operation", nonce: 7, raw: replacement, previous: [{ hash: keccak256(raw), raw }],
    }));
    expect(keeperRepo.release).toHaveBeenCalledOnce();
  });
  it("rejects a changed value, call, nonce, or signer before persisting anything", async () => {
    for (const changes of [{ value: 1n }, { data: "0xaabbccde" as const }, { nonce: 8 }]) {
      const replacement = await account.signTransaction({ ...transaction, ...changes,
        maxFeePerGas: 120n, maxPriorityFeePerGas: 12n });
      await expect(replaceKeeperTransaction(client, key, replacement)).rejects.toThrow("keeper-replacement-authority-mismatch");
    }
    const other = privateKeyToAccount(`0x${"2".repeat(64)}`);
    await expect(replaceKeeperTransaction(client, key, await other.signTransaction({ ...transaction,
      maxFeePerGas: 120n, maxPriorityFeePerGas: 12n }))).rejects.toThrow("keeper-replacement-authority-mismatch");
    expect(keeperRepo.replaced).not.toHaveBeenCalled();
  });
  it("rejects a fee bump below policy and an unconfigured chain", async () => {
    const replacement = await account.signTransaction({ ...transaction, maxFeePerGas: 119n, maxPriorityFeePerGas: 12n });
    await expect(replaceKeeperTransaction(client, key, replacement)).rejects.toThrow("keeper-replacement-fee-invalid");
    await expect(replaceKeeperTransaction(client, key.replace("143:", "1:"), replacement)).rejects.toThrow("keeper-replacement-invalid");
    expect(keeperRepo.replaced).not.toHaveBeenCalled();
  });
});
