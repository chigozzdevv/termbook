import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletNetwork, networkNotice, walletProvider, type NetworkPrompt } from "../src/wallet/network.js";
import { TermbookClient } from "../src/client/client.js";

const address = "0x1111111111111111111111111111111111111111";
function provider(options: { chain?: number; missing?: boolean; reject?: boolean; refuse?: boolean } = {}) {
  let chain = options.chain ?? 10143;
  let missing = options.missing ?? false;
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_chainId") return `0x${chain.toString(16)}`;
    if (method === "eth_accounts") return [address];
    if (method === "wallet_switchEthereumChain") {
      if (options.reject) throw { code: 4001 };
      if (missing) throw { code: 4902 };
      if (!options.refuse) chain = Number((params![0] as { chainId: string }).chainId);
      return null;
    }
    if (method === "wallet_addEthereumChain") { missing = false; return null; }
    throw new Error(`Unexpected method: ${method}`);
  });
  return { request };
}
afterEach(() => vi.unstubAllGlobals());

describe("Wallet network approval", () => {
  it("continues without a prompt when the correct network is selected", async () => {
    const network = new WalletNetwork(), wallet = provider(), handler = vi.fn();
    network.listen(handler, new AbortController().signal);
    await network.ensure(wallet, 10143);
    expect(handler).not.toHaveBeenCalled();
    expect(wallet.request.mock.calls.map(([request]) => request.method)).toEqual(["eth_chainId"]);
  });

  it("waits for the modal's button before opening the wallet switch request", async () => {
    const network = new WalletNetwork(), wallet = provider();
    let prompt!: NetworkPrompt;
    let approve!: () => void;
    network.listen((value) => { prompt = value; return new Promise<void>((resolve) => { approve = resolve; }); }, new AbortController().signal);
    const pending = network.ensure(wallet, 84532);
    await vi.waitFor(() => expect(prompt?.action).toBe("switch"));
    expect(wallet.request).toHaveBeenCalledTimes(1);
    expect(prompt.name).toBe("Base Sepolia");
    await prompt.approve(); approve(); await pending;
    expect(wallet.request).toHaveBeenCalledWith({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
  });

  it("uses a separate Add network approval with canonical metadata for an unknown chain", async () => {
    const network = new WalletNetwork(), wallet = provider({ missing: true }), actions: string[] = [];
    network.listen(async (prompt) => { actions.push(prompt.action); await prompt.approve(); }, new AbortController().signal);
    await network.ensure(wallet, 84532);
    expect(actions).toEqual(["switch", "add"]);
    expect(wallet.request).toHaveBeenCalledWith({ method: "wallet_addEthereumChain", params: [expect.objectContaining({
      chainId: "0x14a34", chainName: "Base Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"],
    })] });
    expect(Number(await wallet.request({ method: "eth_chainId" }))).toBe(84532);
  });

  it("does not add networks after rejection, and supports a later retry", async () => {
    const network = new WalletNetwork(), options = { reject: true }, wallet = provider(options);
    await expect(network.ensure(wallet, 84532)).rejects.toMatchObject({ code: 4001 });
    expect(wallet.request.mock.calls.some(([request]) => request.method === "wallet_addEthereumChain")).toBe(false);
    options.reject = false;
    await network.ensure(wallet, 84532);
  });

  it("rejects a wallet that accepts switching but remains on the wrong chain", async () => {
    await expect(new WalletNetwork().ensure(provider({ refuse: true }), 84532)).rejects.toThrow("wallet-network-mismatch");
  });

  it("cancels a pending approval when the modal closes and prevents a late wallet request", async () => {
    const network = new WalletNetwork(), wallet = provider(), abort = new AbortController();
    let prompt!: NetworkPrompt;
    const stop = network.listen((value) => { prompt = value; return new Promise<void>((_resolve, reject) => {
      abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
    }); }, abort.signal);
    const pending = network.ensure(wallet, 84532);
    await vi.waitFor(() => expect(prompt).toBeDefined());
    abort.abort(new Error("Modal closed")); stop();
    await expect(pending).rejects.toThrow("Modal closed");
    await expect(prompt.approve()).rejects.toThrow("Modal closed");
    expect(wallet.request).toHaveBeenCalledTimes(1);
    await network.ensure(wallet, 10143);
  });

  it("checks cancellation again after wallet approval before continuing", async () => {
    const network = new WalletNetwork(), abort = new AbortController(), wallet = provider({ missing: true });
    network.listen(async (prompt) => { await prompt.approve(); abort.abort(new Error("Closed")); }, abort.signal);
    await expect(network.ensure(wallet, 84532)).rejects.toThrow("Closed");
  });

  it("never replaces the selected provider with another injected wallet", async () => {
    const selected = provider(), other = provider();
    vi.stubGlobal("ethereum", other);
    const wallet = await walletProvider({ address, request: selected.request, signTypedData: vi.fn() });
    await new WalletNetwork().ensure(wallet, 84532);
    expect(other.request).not.toHaveBeenCalled();
    selected.request.mockResolvedValueOnce(["0x2222222222222222222222222222222222222222"]);
    await expect(walletProvider({ address, request: selected.request, signTypedData: vi.fn() })).rejects.toThrow("wallet-account-mismatch");
  });

  it("ensures Monad before signing or sending borrower transactions", async () => {
    const wallet = provider({ chain: 84532 });
    const writeContract = vi.fn().mockResolvedValue(`0x${"a".repeat(64)}`);
    const signTypedData = vi.fn().mockResolvedValue(`0x${"b".repeat(64)}`);
    const client = new TermbookClient({ appToken: "test", core: address, rpcUrl: "https://rpc.example", chainId: 10143,
      wallet: { address, request: wallet.request, getChainId: async () => Number(await wallet.request({ method: "eth_chainId" })), writeContract, signTypedData } });
    await client.signer.sign({ message: "test" });
    expect(Number(await wallet.request({ method: "eth_chainId" }))).toBe(10143);
    await client.config.wallet.writeContract!({ address, account: address, abi: [], functionName: "test" });
    expect(signTypedData).toHaveBeenCalledOnce(); expect(writeContract).toHaveBeenCalledOnce();
  });

  it("keeps provider details out of retry messages", () => {
    expect(networkNotice({ code: 4001, message: "https://private.example/key" },
      { chainId: 84532, name: "Base Sepolia", action: "switch", approve: vi.fn() })).toBe("Request declined. Click Switch network to try again.");
  });
});
