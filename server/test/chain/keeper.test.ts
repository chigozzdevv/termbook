import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, TransactionReceiptNotFoundError, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keeperTransaction, reconcileKeeperWallet } from "../../src/chain/keeper.js";
import { keeperRepo, type PendingTransaction } from "../../src/chain/keeper.repo.js";

const wallet = vi.hoisted(() => ({ prepareTransactionRequest: vi.fn(), signTransaction: vi.fn() }));
vi.mock("viem", async (load) => ({ ...await load<typeof import("viem")>(), createWalletClient: () => wallet }));
vi.mock("../../src/chain/keeper.repo.js", () => ({ keeperRepo: {
  claim: vi.fn(), renew: vi.fn(), prepared: vi.fn(), result: vi.fn(), completed: vi.fn(), release: vi.fn(),
} }));
let raw: Hex;
let hash: Hex;
const blockHash = `0x${"b".repeat(64)}` as const;
const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const address = account.address;
const request = { chainId: 143, type: "legacy" as const, nonce: 7, to: address,
  data: "0xaabbccdd" as const, gas: 40_000n, gasPrice: 10n };
const balance = vi.fn();
const receipt = vi.fn();
const send = vi.fn();
const block = vi.fn();
const count = vi.fn();
const input = { client: { getChainId: async () => 143, getTransactionCount: count,
  getTransactionReceipt: receipt, sendRawTransaction: send, getBlock: block, getBalance: balance } as never,
rpcUrl: "http://127.0.0.1", chainId: 143, account,
operation: "credit:4:recover", to: address, data: "0xaabbccdd" as const };
let pending: PendingTransaction | undefined;
beforeEach(async () => {
  vi.resetAllMocks(); pending = undefined;
  raw = await account.signTransaction(request);
  hash = keccak256(raw);
  balance.mockResolvedValue(1_000_000n);
  vi.mocked(keeperRepo.claim).mockImplementation(async () => ({ lease: "lease", ...(pending ? { pending } : {}) }));
  vi.mocked(keeperRepo.renew).mockResolvedValue(true);
  vi.mocked(keeperRepo.prepared).mockImplementation(async (_key, _lease, value) => { pending = value; });
  wallet.prepareTransactionRequest.mockResolvedValue(request);
  wallet.signTransaction.mockResolvedValue(raw);
  count.mockResolvedValue(7);
  receipt.mockRejectedValue(new TransactionReceiptNotFoundError({ hash }));
  send.mockResolvedValue(hash);
  block.mockResolvedValue({ number: 100n, hash: blockHash, transactions: [hash] });
});

describe("durable keeper transactions", () => {
  it("persists Base safe finality without accepting it for mainnet or confirmation-count policies", async () => {
    await expect(keeperTransaction({ ...input, testnetFinality: "safe" })).rejects.toThrow("keeper-confirmation-policy-invalid");
    const base = { ...input, chainId: 84532, client: { ...input.client as object, getChainId: async () => 84532 } as never, testnetFinality: "safe" as const };
    await keeperTransaction(base);
    expect(pending?.testnetFinality).toBe("safe");
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 101n, blockHash, transactionIndex: 0, status: "success" });
    expect(await keeperTransaction(base)).toBe("pending");
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 100n, blockHash, transactionIndex: 0, status: "success" });
    expect(await keeperTransaction(base)).toBe("success");
    expect(block).toHaveBeenCalledWith({ blockTag: "safe" });
    await expect(keeperTransaction({ ...base, testnetConfirmations: 5 })).rejects.toThrow("keeper-confirmation-policy-invalid");
  });
  it("persists Sepolia confirmation depth and cannot apply it to a mainnet transaction", async () => {
    await expect(keeperTransaction({ ...input, testnetConfirmations: 5 })).rejects.toThrow("keeper-confirmation-policy-invalid");
    const source = { ...input, chainId: 11155111, client: { ...input.client as object, getChainId: async () => 11155111 } as never, testnetConfirmations: 5 };
    await keeperTransaction(source);
    expect(pending?.testnetConfirmations).toBe(5);
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 96n, blockHash, transactionIndex: 0, status: "success" });
    expect(await keeperTransaction(source)).toBe("pending");
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 95n, blockHash, transactionIndex: 0, status: "success" });
    expect(await keeperTransaction(source)).toBe("success");
    expect(block).toHaveBeenCalledWith({ blockTag: "latest" });
  });
  it("keeps an unfunded journal intact and rebroadcasts the same bytes after a top-up", async () => {
    await keeperTransaction(input);
    const original = pending;
    balance.mockResolvedValue(1n);
    await expect(keeperTransaction(input)).rejects.toThrow("keeper-funding-insufficient");
    expect(pending).toBe(original);
    expect(send).toHaveBeenCalledTimes(1);
    expect(keeperRepo.completed).not.toHaveBeenCalled();
    balance.mockResolvedValue(1_000_000n);
    expect(await keeperTransaction(input)).toBe("pending");
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ serializedTransaction: raw });
  });

  it("reconciles an existing transaction without rerunning or signing its original action", async () => {
    await keeperTransaction(input);
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 100n, blockHash,
      transactionIndex: 0, status: "success" });
    expect(await reconcileKeeperWallet(input.client, input.chainId, address)).toBe("success");
    expect(keeperRepo.completed).toHaveBeenCalledWith(expect.any(String), "lease", pending,
      "success", 100n, blockHash, hash);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    pending = undefined;
    expect(await reconcileKeeperWallet(input.client, input.chainId, address)).toBe("idle");
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
  });

  it("persists the exact signed transaction before broadcasting and resumes its nonce", async () => {
    send.mockImplementationOnce(async () => {
      expect(pending?.raw).toBe(raw);
      throw new Error("rpc-response-lost");
    });
    await expect(keeperTransaction(input)).rejects.toThrow("rpc-response-lost");
    expect(pending?.nonce).toBe(7);
    expect(await keeperTransaction(input)).toBe("pending");
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ serializedTransaction: raw });
    expect(keeperRepo.completed).not.toHaveBeenCalled();
    expect(keeperRepo.release).toHaveBeenCalledTimes(2);
  });

  it("does not clear or repeat a mined transaction until canonical finality", async () => {
    await keeperTransaction(input);
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 101n, blockHash,
      transactionIndex: 0, status: "success" });
    expect(await keeperTransaction(input)).toBe("pending");
    expect(keeperRepo.completed).not.toHaveBeenCalled();
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 100n, blockHash,
      transactionIndex: 0, status: "success" });
    expect(await keeperTransaction(input)).toBe("success");
    expect(keeperRepo.completed).toHaveBeenCalledWith(expect.any(String), "lease", pending,
      "success", 100n, blockHash, hash);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps ambiguous RPC failures and finality conflicts out of completion", async () => {
    await keeperTransaction(input);
    receipt.mockRejectedValueOnce(new Error("rpc-unavailable"));
    await expect(keeperTransaction(input)).rejects.toThrow("rpc-unavailable");
    expect(send).toHaveBeenCalledTimes(1);
    receipt.mockResolvedValue({ transactionHash: hash, blockNumber: 100n,
      blockHash: `0x${"c".repeat(64)}`, transactionIndex: 0, status: "success" });
    await expect(keeperTransaction(input)).rejects.toThrow("keeper-finality-conflict");
    expect(keeperRepo.completed).not.toHaveBeenCalled();
  });

  it("reconciles another pending operation before allocating a new nonce", async () => {
    await keeperTransaction(input);
    expect(await keeperTransaction({ ...input, operation: "other" })).toBe("pending");
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    vi.mocked(keeperRepo.claim).mockResolvedValue(null);
    expect(await keeperTransaction(input)).toBe("busy");
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
  });

  it("allows a reverted operation to retry after eligibility is rechecked by its caller", async () => {
    vi.mocked(keeperRepo.result).mockResolvedValue("reverted");
    expect(await keeperTransaction(input)).toBe("pending");
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ serializedTransaction: raw });
  });

  it("recognizes the original transaction if it wins a replacement race", async () => {
    await keeperTransaction(input);
    const replacement = await account.signTransaction({ ...request, gasPrice: 12n });
    pending = { ...pending!, raw: replacement, hash: keccak256(replacement), previous: [{ hash, raw }] };
    receipt.mockImplementation(async ({ hash: candidate }: { hash: string }) => {
      if (candidate !== hash) throw new TransactionReceiptNotFoundError({ hash: candidate as `0x${string}` });
      return { transactionHash: hash, blockNumber: 100n, blockHash, transactionIndex: 0, status: "success" };
    });
    expect(await keeperTransaction(input)).toBe("success");
    expect(keeperRepo.completed).toHaveBeenCalledWith(expect.any(String), "lease", pending,
      "success", 100n, blockHash, hash);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
  });
});
