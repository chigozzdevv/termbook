import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, parseTransaction, TransactionReceiptNotFoundError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { keeperRepo } from "../../src/chain/keeper.repo.js";

const rpc = vi.hoisted(() => ({ chainId: 10143 }));
vi.mock("viem", async (load) => {
  const actual = await load<typeof import("viem")>();
  return { ...actual, createWalletClient: (options: Parameters<typeof actual.createWalletClient>[0]) =>
    actual.createWalletClient({ ...options, transport: actual.custom({ request: async ({ method }) => {
      if (method === "eth_chainId") return actual.toHex(rpc.chainId);
      if (method === "eth_getTransactionCount") return "0x0";
      if (method === "eth_estimateGas") return "0x30d40";
      if (method === "eth_gasPrice") return "0x174876e800";
      if (method === "eth_getBlockByNumber") return { number: "0x1", hash: actual.zeroHash, transactions: [] };
      throw new Error(`Unexpected RPC ${method}`);
    } }) }) };
});
vi.mock("../../src/chain/keeper.repo.js", () => ({ keeperRepo: {
  claim: vi.fn(), renew: vi.fn(), prepared: vi.fn(), result: vi.fn(), completed: vi.fn(), release: vi.fn(),
} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(keeperRepo.claim).mockResolvedValue({ lease: "lease" });
});
describe("keeper local transaction signing", () => {
  it.each([10143, 11155111])("signs and journals a valid transaction for chain %i without a configured viem chain", async (chainId) => {
    rpc.chainId = chainId;
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const sendRawTransaction = vi.fn(async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => keccak256(serializedTransaction));
    const client = { getChainId: async () => chainId, getTransactionCount: async () => 0,
      getTransactionReceipt: async () => { throw new TransactionReceiptNotFoundError({ hash: keccak256("0x1234") }); }, sendRawTransaction };
    expect(await keeperTransaction({ client: client as never, rpcUrl: "http://unused", chainId,
      account, operation: "update", to: account.address, data: "0x1234" })).toBe("pending");
    const journal = vi.mocked(keeperRepo.prepared).mock.calls[0]?.[2];
    expect(journal).toBeDefined();
    const transaction = parseTransaction(journal!.raw);
    expect(transaction.chainId).toBe(chainId);
    expect(transaction.nonce).toBe(0);
    expect(transaction.to?.toLowerCase()).toBe(account.address.toLowerCase());
    expect(transaction.data).toBe("0x1234");
    expect(keccak256(journal!.raw)).toBe(journal!.hash);
    expect(sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: journal!.raw });
  });
});
