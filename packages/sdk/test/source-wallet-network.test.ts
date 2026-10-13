import { beforeEach, describe, expect, it, vi } from "vitest";
import { TermbookClient } from "../src/client/client.js";
import type { CollateralMarket, CollateralSetupBinding } from "@termbook/schema";

const source = vi.hoisted(() => ({ preflight: vi.fn(), remoteRecoveryVault: vi.fn(), observeLock: vi.fn(), submitLock: vi.fn(), submitAction: vi.fn() }));
vi.mock("../src/collateral/evm-source.js", () => ({ EvmSourceLockWallet: class {
  account = { namespace: "eip155", reference: "84532", accountBytes: "0x1111111111111111111111111111111111111111" };
  preflight = source.preflight; remoteRecoveryVault = source.remoteRecoveryVault;
  observeLock = source.observeLock; submitLock = source.submitLock; submitAction = source.submitAction;
} }));
const address = "0x1111111111111111111111111111111111111111", hash = `0x${"a".repeat(64)}` as const;
const market: CollateralMarket = { id: "base", kind: "evm", label: "Base ETH", chainId: 84532,
  rpcUrl: "https://sepolia.base.org", vault: address, asset: address, controller: address, decimals: 18, nativeVault: false };
const binding = {} as CollateralSetupBinding;
beforeEach(() => {
  vi.clearAllMocks(); source.submitLock.mockResolvedValue({ txId: hash }); source.observeLock.mockResolvedValue({ state: "submitted", txId: hash });
});

function client() {
  let chain = 10143;
  let denyReturn = false;
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_chainId") return `0x${chain.toString(16)}`;
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
    if (method === "wallet_switchEthereumChain") {
      const next = Number((params![0] as { chainId: string }).chainId);
      if (next === 10143 && denyReturn) throw { code: 4001 };
      chain = next; return null;
    }
    throw new Error(`Unexpected method ${method}`);
  });
  return { sdk: new TermbookClient({ appToken: "test", core: address, rpcUrl: "https://rpc.example", chainId: 10143,
    wallet: { address, request, signTypedData: vi.fn() } }), request, denyReturn: () => { denyReturn = true; } };
}
describe("Source wallet network lifecycle", () => {
  it("returns to Monad after connection and read-only checks", async () => {
    const { sdk, request } = client(); const wallet = await sdk.sourceWallet(market);
    expect(Number(await request({ method: "eth_chainId" }))).toBe(10143);
    await wallet.remoteRecoveryVault!(binding);
    expect(source.remoteRecoveryVault).toHaveBeenCalledWith(binding);
    expect(Number(await request({ method: "eth_chainId" }))).toBe(10143);
  });

  it("returns the submitted hash before switching back, so a declined return cannot lose the checkpoint", async () => {
    const { sdk, request, denyReturn } = client(); const wallet = await sdk.sourceWallet(market);
    denyReturn();
    const submitted = await wallet.submitLock(binding, hash, 1n);
    expect(submitted.txId).toBe(hash);
    expect(Number(await request({ method: "eth_chainId" }))).toBe(84532);
    await expect(wallet.observeLock(binding, hash, submitted.txId)).rejects.toMatchObject({ code: 4001 });
    expect(source.submitLock).toHaveBeenCalledOnce();
  });

  it("stops a source transaction after the modal's operation is canceled", async () => {
    const { sdk } = client(), abort = new AbortController();
    const wallet = await sdk.sourceWallet(market, { signal: abort.signal });
    abort.abort(new Error("Closed"));
    await expect(wallet.submitLock(binding, hash, 1n)).rejects.toThrow("Closed");
    expect(source.submitLock).not.toHaveBeenCalled();
  });
});
