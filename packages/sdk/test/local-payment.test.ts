import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData } from "viem";
import { houseVaultAbi } from "@termbook/bindings";
import { House } from "../src/house/house.js";
import { LocalPaymentPendingError } from "../src/settlement/local-payment.js";
const a = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const w = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
function fixture() {
  const payer = a("1"), vault = a("2"), asset = a("3"), tx = w("4"), blockHash = w("5");
  const args = { amount: 100n, minShares: 80n, deadline: Math.floor(Date.now() / 1000) + 600 };
  const rpc = { read: vi.fn(async (_a, _b, name: string) => name === "totalShares" ? 1000n : asset),
    vaultSharePrice: async () => 10n ** 18n, approve: vi.fn(async () => tx), wait: vi.fn(async () => {}),
    write: vi.fn(async () => tx), client: {
      getChainId: async () => 143,
      getBlock: vi.fn(async () => ({ number: 10n, hash: blockHash, transactions: [tx] })),
      getTransaction: async () => ({ from: payer, to: vault, value: 0n, input: encodeFunctionData({ abi: houseVaultAbi,
        functionName: "depositBound", args: [payer, args.amount, args.minShares, BigInt(args.deadline)] }) }),
      getTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 10n, blockHash, transactionIndex: 0,
        logs: [{ address: vault, topics: encodeEventTopics({ abi: houseVaultAbi, eventName: "Deposited", args: { payer, recipient: payer } }),
          data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [100n, 90n]) }] })),
    } };
  const house = new House({ ready: async () => {}, config: { chainId: 143 }, signer: { address: () => payer }, rpc } as never, vault);
  return { house, rpc, args };
}
describe("local deposit completion", () => {
  it("returns receipt shares when the share price moves between review and execution", async () => {
    const f = fixture();
    expect(await f.house.deposit(f.args)).toMatchObject({ shares: 90n, status: "applied", localCheckpoint: { stage: "complete" } });
  });
  it("preserves a submitted transaction through timeout and resumes without another approval or deposit", async () => {
    const f = fixture();
    f.rpc.client.getBlock.mockResolvedValue({ number: 9n, hash: w("5"), transactions: [w("4")] });
    const error = await f.house.deposit(f.args, { timeoutMs: 20, pollIntervalMs: 1 }).catch((caught) => caught);
    expect(error).toBeInstanceOf(LocalPaymentPendingError);
    expect(error.checkpoint.tx).toBe(w("4"));
    f.rpc.client.getBlock.mockResolvedValue({ number: 10n, hash: w("5"), transactions: [w("4")] });
    expect(await f.house.resumeLocalDeposit(error.checkpoint)).toMatchObject({ shares: 90n });
    expect(f.rpc.write).toHaveBeenCalledOnce(); expect(f.rpc.approve).toHaveBeenCalledOnce();
  });
  it("rejects a noncanonical receipt before returning minted shares", async () => {
    const f = fixture();
    f.rpc.client.getBlock.mockResolvedValue({ number: 10n, hash: w("9"), transactions: [w("4")] });
    await expect(f.house.deposit(f.args)).rejects.toMatchObject({ cause: { message: "payment-transaction-invalid" } });
  });
});
