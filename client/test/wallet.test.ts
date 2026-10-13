import { describe, expect, it, vi } from "vitest";
import {
  connectWallet,
  readConnection,
  preferredWallets,
  switchWallet,
  addWallet,
  WalletNetworkError,
  walletErrorMessage,
  type BrowserWallet,
  type Provider,
} from "../src/features/wallet/connection";
import { brandFor, imageSource, legacyInfo } from "../src/features/wallet/branding";

const first = "0x1111111111111111111111111111111111111111";
const second = "0x2222222222222222222222222222222222222222";

function browser(
  options: {
    chain?: number;
    missing?: boolean;
    reject?: boolean;
    refuseSwitch?: boolean;
    changeAccount?: boolean;
    changeDuringRead?: boolean;
    accounts?: string[];
    switchError?: { code: number; message: string };
    addError?: { code: number; message: string };
    loseAccount?: boolean;
    ignoreAdd?: boolean;
    autoSwitchOnAdd?: boolean;
  } = {},
) {
  let chain = options.chain ?? 10143;
  let accounts = options.accounts ?? [first];
  let added = !options.missing;
  let readingAccounts = false;
  let changed = false;
  const listeners = new Map<string, Set<() => void>>();
  const methods: string[] = [];
  const requests: { method: string; params?: unknown }[] = [];
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      methods.push(method);
      requests.push({ method, params });
      switch (method) {
        case "eth_requestAccounts":
          return accounts;
        case "eth_accounts":
          readingAccounts = true;
          return accounts;
        case "eth_chainId":
          if (options.changeDuringRead && readingAccounts && !changed) {
            accounts = [second];
            changed = true;
            listeners.get("accountsChanged")?.forEach((listener) => listener());
          }
          return `0x${chain.toString(16)}`;
        case "wallet_addEthereumChain":
          if (options.addError) throw options.addError;
          added = !options.ignoreAdd;
          if (options.autoSwitchOnAdd) chain = 10143;
          return null;
        case "wallet_switchEthereumChain":
          if (options.switchError) throw options.switchError;
          if (options.reject) throw { code: 4001, message: "User rejected." };
          if (!added) throw { code: 4902, message: "Chain not added." };
          if (!options.refuseSwitch) chain = 10143;
          if (options.changeAccount) accounts = [second];
          if (options.loseAccount) accounts = [];
          return null;
        default:
          throw new Error(`Unexpected wallet method: ${method}`);
      }
    },
    on: (event: string, handler: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeListener: (event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler);
    },
  } as unknown as Provider;
  const wallet: BrowserWallet = {
    source: "eip6963",
    info: { uuid: "test", name: "Test wallet" },
    provider,
  };
  return { wallet, methods, listeners, requests };
}

describe("Direct network addition", () => {
  it("adds Monad testnet with the correct metadata and switches without reauthorizing the account", async () => {
    const { wallet, methods, requests } = browser({ chain: 1, missing: true });
    const onSwitch = vi.fn();
    expect(await addWallet(wallet.provider, undefined, onSwitch)).toMatchObject({
      address: first,
      chain: 10143,
    });
    expect(
      requests.find((request) => request.method === "wallet_addEthereumChain")?.params,
    ).toEqual([
      {
        chainId: "0x279f",
        chainName: "Monad Testnet",
        nativeCurrency: { name: "Testnet MON Token", symbol: "MON", decimals: 18 },
        rpcUrls: ["https://testnet-rpc.monad.xyz"],
        blockExplorerUrls: ["https://testnet.monadexplorer.com"],
      },
    ]);
    expect(methods).toEqual([
      "wallet_addEthereumChain",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_accounts",
      "eth_chainId",
    ]);
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("stops after declined addition and preserves the current account and network", async () => {
    const { wallet, methods } = browser({
      chain: 1,
      addError: { code: 4001, message: "Declined" },
    });
    const onSwitch = vi.fn();
    const error = await addWallet(wallet.provider, undefined, onSwitch).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ connection: { address: first, chain: 1 } });
    expect(walletErrorMessage(error, "adding")).toContain("Network addition declined");
    expect(onSwitch).not.toHaveBeenCalled();
    expect(methods).not.toContain("wallet_switchEthereumChain");
  });

  it("does not report success if the wallet accepted adding but never switched", async () => {
    const { wallet } = browser({ chain: 1, refuseSwitch: true });
    await expect(addWallet(wallet.provider)).rejects.toMatchObject({
      connection: { address: first, chain: 1 },
    });
  });

  it("verifies wallets that switch automatically after addition without another switch prompt", async () => {
    const { wallet, methods } = browser({ chain: 1, autoSwitchOnAdd: true });
    expect((await addWallet(wallet.provider)).chain).toBe(10143);
    expect(methods).not.toContain("wallet_switchEthereumChain");
  });

  it("does not repeat addition when a wallet accepts the request but fails to register the network", async () => {
    const { wallet, methods } = browser({ chain: 1, missing: true, ignoreAdd: true });
    await expect(addWallet(wallet.provider)).rejects.toMatchObject({
      connection: { address: first, chain: 1 },
    });
    expect(methods.filter((method) => method === "wallet_addEthereumChain")).toHaveLength(1);
  });

  it("stops before switching if the connection request was canceled during addition", async () => {
    const { wallet, methods } = browser({ chain: 1 });
    await expect(
      addWallet(wallet.provider, undefined, () => {
        throw new Error("Canceled");
      }),
    ).rejects.toBeInstanceOf(WalletNetworkError);
    expect(methods).not.toContain("wallet_switchEthereumChain");
  });

  it.each([4200, -32601])(
    "explains unsupported network addition for provider code %s",
    async (code) => {
      const { wallet, methods } = browser({ chain: 1, addError: { code, message: "Unsupported" } });
      const error = await addWallet(wallet.provider).catch((error: unknown) => error);
      expect(walletErrorMessage(error, "adding")).toContain(
        "cannot add this network automatically",
      );
      expect(methods).not.toContain("wallet_switchEthereumChain");
    },
  );
});

describe("Manager wallet connection", () => {
  it("requests wallet access and binds its current account without signing or sending transactions", async () => {
    const { wallet, methods } = browser();
    expect(await connectWallet(wallet)).toMatchObject({ address: first, chain: 10143 });
    expect(methods).toEqual(["eth_requestAccounts", "eth_accounts", "eth_chainId"]);
  });

  it.each([1, 10143])("reports a switch phase only when needed on chain %s", async (chain) => {
    const { wallet } = browser({ chain });
    const onSwitch = vi.fn();
    await connectWallet(wallet, undefined, onSwitch);
    expect(onSwitch).toHaveBeenCalledTimes(chain === 10143 ? 0 : 1);
  });

  it("adds Monad testnet only when the wallet reports an unknown network", async () => {
    const { wallet, methods } = browser({ chain: 1, missing: true });
    expect((await connectWallet(wallet)).chain).toBe(10143);
    expect(methods.filter((method) => method.startsWith("wallet_"))).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
  });

  it("preserves a rejected network switch without trying to add the chain", async () => {
    const { wallet, methods } = browser({ chain: 1, reject: true });
    await expect(connectWallet(wallet)).rejects.toMatchObject({
      connection: { address: first, chain: 1 },
    });
    expect(methods).not.toContain("wallet_addEthereumChain");
  });

  it("retries switching an authorized wallet without requesting account access again", async () => {
    const options = { chain: 1, reject: true };
    const { wallet, methods } = browser(options);
    await expect(connectWallet(wallet)).rejects.toBeInstanceOf(WalletNetworkError);
    options.reject = false;
    expect(await switchWallet(wallet.provider)).toMatchObject({ address: first, chain: 10143 });
    expect(methods.filter((method) => method === "eth_requestAccounts")).toHaveLength(1);
    expect(methods).not.toContain("eth_sendTransaction");
    expect(methods).not.toContain("personal_sign");
  });

  it("keeps the account connected when adding the missing network is declined", async () => {
    const { wallet } = browser({
      chain: 1,
      missing: true,
      addError: { code: 4001, message: "No" },
    });
    const error = await connectWallet(wallet).catch((error: unknown) => error);
    expect(error).toMatchObject({ connection: { address: first, chain: 1 } });
    expect(walletErrorMessage(error, "switching")).toContain("Network switch declined");
  });

  it.each([-32002, 4200, -32601])("does not add a network for provider error %s", async (code) => {
    const { wallet, methods } = browser({
      chain: 1,
      switchError: { code, message: "Request failed" },
    });
    const error = await connectWallet(wallet).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(WalletNetworkError);
    expect(error).toMatchObject({ connection: { address: first, chain: 1 } });
    expect(methods).not.toContain("wallet_addEthereumChain");
    expect(walletErrorMessage(error, "switching")).toContain(
      code === -32002 ? "pending" : "Click Add network",
    );
  });

  it("does not retain an account that disappears during the switch", async () => {
    const { wallet } = browser({ chain: 1, loseAccount: true });
    await expect(connectWallet(wallet)).rejects.toMatchObject({ connection: undefined });
  });

  it("rejects a wallet that remains on the wrong chain after switching", async () => {
    const { wallet } = browser({ chain: 1, refuseSwitch: true });
    await expect(connectWallet(wallet)).rejects.toThrow("Switch to Monad Testnet");
  });

  it("uses the account actually selected after network prompts", async () => {
    const { wallet } = browser({ chain: 1, changeAccount: true });
    expect((await connectWallet(wallet)).address).toBe(second);
  });

  it("retries when the account changes while reading its network and removes temporary listeners", async () => {
    const { wallet, listeners } = browser({ changeDuringRead: true });
    expect((await connectWallet(wallet)).address).toBe(second);
    expect([...listeners.values()].every((handlers) => handlers.size === 0)).toBe(true);
  });

  it("rejects a connection with no selected account", async () => {
    const { wallet } = browser({ accounts: [] });
    await expect(connectWallet(wallet)).rejects.toThrow("No wallet account was selected");
    expect(await readConnection(wallet.provider)).toBeUndefined();
  });

  it.each(["0x0000000000000000000000000000000000000000", "invalid"])(
    "rejects invalid manager identity %s",
    async (address) => {
      const { wallet } = browser({ accounts: [address] });
      await expect(connectWallet(wallet)).rejects.toThrow();
      await expect(readConnection(wallet.provider)).rejects.toThrow("Invalid wallet account");
    },
  );
});

describe("Wallet failure messages", () => {
  it("reads the underlying provider code through RPC wrappers", () => {
    expect(walletErrorMessage({ code: -1, cause: { code: -32002 } }, "switching")).toContain(
      "pending",
    );
  });

  it.each([4100, 4900, 4901])(
    "explains provider error %s without leaking the raw payload",
    (code) => {
      const message = walletErrorMessage(
        { code, message: "https://private-rpc.example/secret" },
        "switching",
      );
      expect(message).toContain(code === 4100 ? "not authorized" : "disconnected");
      expect(message).not.toContain("secret");
    },
  );

  it("offers direct network addition for an unclassified switching failure", () => {
    expect(walletErrorMessage(new Error("private debug data"), "switching")).toContain(
      "Click Add network",
    );
    expect(walletErrorMessage(new Error("private debug data"), "switching")).not.toContain(
      "private debug data",
    );
  });
});

describe("Wallet discovery", () => {
  const legacy = (): BrowserWallet => ({
    ...browser().wallet,
    source: "legacy",
    info: { uuid: "injected", name: "Rabby", rdns: "io.rabby" },
  });
  const announced = (): BrowserWallet => ({
    ...browser().wallet,
    info: { uuid: "rabby-session", name: "Rabby Wallet", rdns: "io.rabby" },
  });

  it.each(["legacy-first", "announcement-first"])(
    "shows one Rabby entry with different provider wrappers: %s",
    (order) => {
      const fallback = legacy(),
        primary = announced();
      expect(fallback.provider).not.toBe(primary.provider);
      const wallets = order === "legacy-first" ? [fallback, primary] : [primary, fallback];
      expect(preferredWallets(wallets)).toEqual([primary]);
      expect(preferredWallets(wallets)[0].info.name).toBe("Rabby Wallet");
    },
  );

  it("retains every announced wallet without an extra legacy entry", () => {
    const rabby = announced(),
      metamask = {
        ...browser().wallet,
        info: { uuid: "metamask-session", name: "MetaMask", rdns: "io.metamask" },
      };
    expect(preferredWallets([legacy(), rabby, metamask])).toEqual([rabby, metamask]);
  });

  it("uses the legacy provider when no wallet announces itself", () => {
    const fallback = legacy();
    expect(preferredWallets([fallback])).toEqual([fallback]);
    expect(preferredWallets([])).toEqual([]);
  });
});

describe("Wallet branding", () => {
  it("accepts embedded provider logos and bundled official assets", () => {
    const icon =
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
    expect(imageSource(icon)).toBe(icon);
    expect(imageSource("/wallets/metamask.svg")).toBe("/wallets/metamask.svg");
  });

  it.each([
    "https://example.com/tracking.svg",
    "//example.com/icon.png",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ])("rejects external or executable icon source %s", (source) => {
    expect(imageSource(source)).toBeUndefined();
  });

  it("bounds provider icon size", () => {
    expect(imageSource(`data:image/png;base64,${"a".repeat(250_000)}`)).toBeUndefined();
  });

  it("identifies legacy Rabby before its MetaMask compatibility flag", () => {
    const { wallet } = browser();
    Object.assign(wallet.provider, { isMetaMask: true, isRabby: true });
    expect(legacyInfo(wallet.provider).name).toBe("Rabby");
  });

  it("uses announced identifiers for display aliases", () => {
    expect(brandFor({ uuid: "test", name: "Rabby Wallet", rdns: "io.rabby" })?.icon).toBe(
      "/wallets/rabby.svg",
    );
  });
});
