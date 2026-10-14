import { describe, expect, it, vi } from "vitest";
import { createWalletClient, http, recoverMessageAddress, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { evm_wallet } from "../src/wallet/evm.js";

const address = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = `0x${"a".repeat(64)}`;

function connected() {
  return {
    getAddresses: vi.fn().mockResolvedValue([address]),
    getChainId: vi.fn().mockResolvedValue(10143),
    signMessage: vi.fn().mockResolvedValue(hash),
    signTypedData: vi.fn().mockResolvedValue(hash),
    writeContract: vi.fn().mockResolvedValue(hash),
    chain: { id: 10143 },
  };
}

describe("viem wallet adapter", () => {
  it("uses the connected account for messages, typed data and bounded contract writes", async () => {
    const client = connected();
    const wallet = await evm_wallet(client as unknown as WalletClient);
    expect(wallet.address).toBe(address);
    expect(await wallet.getChainId!()).toBe(10143);
    await wallet.signMessage!("Sign in");
    expect(client.signMessage).toHaveBeenCalledWith({ account: address, message: "Sign in" });
    await wallet.signDigest!(hash);
    expect(client.signMessage).toHaveBeenCalledWith({ account: address, message: { raw: hash } });
    const payload = { account: other, domain: { chainId: 10143 }, message: { amount: 100n } };
    await wallet.signTypedData(payload);
    expect(client.signTypedData).toHaveBeenCalledWith({ ...payload, account: address });
    const request = { address: other, account: address, abi: [], functionName: "deposit", args: [100n], value: 1n, gas: 300_000n } as const;
    expect(await wallet.writeContract!(request)).toBe(hash);
    expect(client.writeContract).toHaveBeenCalledWith({ ...request, chain: client.chain });
  });

  it("signs execution digests as bytes accepted by onchain personal-sign verification", async () => {
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const client = createWalletClient({ account, transport: http("http://127.0.0.1:1") });
    const signMessage = vi.fn((args: Parameters<typeof client.signMessage>[0]) => account.signMessage({ message: args.message }));
    const wallet = await evm_wallet({ ...client, signMessage } as WalletClient);
    const signature = await wallet.signDigest!(hash);
    expect(await recoverMessageAddress({ message: { raw: hash }, signature })).toBe(account.address);
    expect(await recoverMessageAddress({ message: hash, signature })).not.toBe(account.address);
  });

  it("refuses a disconnected client and writes claiming another sender", async () => {
    const client = connected();
    client.getAddresses.mockResolvedValueOnce([]);
    await expect(evm_wallet(client as unknown as WalletClient)).rejects.toThrow("wallet-not-connected");
    const wallet = await evm_wallet(client as unknown as WalletClient);
    expect(() => wallet.writeContract!({ address: other, account: other, abi: [], functionName: "deposit" })).toThrow("wallet-account-mismatch");
    expect(client.writeContract).not.toHaveBeenCalled();
  });

  it("reports provider chain changes and propagates wallet rejection", async () => {
    const client = connected();
    const wallet = await evm_wallet(client as unknown as WalletClient);
    client.getChainId.mockResolvedValue(11155111);
    expect(await wallet.getChainId!()).toBe(11155111);
    client.signMessage.mockRejectedValue(new Error("User rejected"));
    await expect(wallet.signMessage!("Sign in")).rejects.toThrow("User rejected");
  });

  it("refuses signing and writes after the selected account changes", async () => {
    const client = connected();
    const wallet = await evm_wallet(client as unknown as WalletClient);
    client.getAddresses.mockResolvedValue([other]);
    await expect(wallet.signMessage!("Sign in")).rejects.toThrow("wallet-account-mismatch");
    await expect(wallet.signDigest!(hash)).rejects.toThrow("wallet-account-mismatch");
    await expect(wallet.signTypedData({})).rejects.toThrow("wallet-account-mismatch");
    await expect(wallet.writeContract!({ address: other, account: address, abi: [], functionName: "deposit" })).rejects.toThrow("wallet-account-mismatch");
    expect(client.signMessage).not.toHaveBeenCalled(); expect(client.signTypedData).not.toHaveBeenCalled(); expect(client.writeContract).not.toHaveBeenCalled();
  });
});
