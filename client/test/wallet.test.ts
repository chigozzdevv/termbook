import { describe, expect, it } from "vitest";
import {
  connectWallet,
  readConnection,
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
  } = {},
) {
  let chain = options.chain ?? 10143;
  let accounts = options.accounts ?? [first];
  let added = !options.missing;
  let readingAccounts = false;
  let changed = false;
  const listeners = new Map<string, Set<() => void>>();
  const methods: string[] = [];
  const provider = {
    request: async ({ method }: { method: string }) => {
      methods.push(method);
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
          added = true;
          return null;
        case "wallet_switchEthereumChain":
          if (options.reject) throw { code: 4001, message: "User rejected." };
          if (!added) throw { code: 4902, message: "Chain not added." };
          if (!options.refuseSwitch) chain = 10143;
          if (options.changeAccount) accounts = [second];
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
  const wallet: BrowserWallet = { info: { uuid: "test", name: "Test wallet" }, provider };
  return { wallet, methods, listeners };
}

describe("Manager wallet connection", () => {
  it("requests wallet access and binds its current account without signing or sending transactions", async () => {
    const { wallet, methods } = browser();
    expect(await connectWallet(wallet)).toMatchObject({ address: first, chain: 10143 });
    expect(methods).toEqual(["eth_requestAccounts", "eth_chainId", "eth_accounts", "eth_chainId"]);
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
    await expect(connectWallet(wallet)).rejects.toThrow();
    expect(methods).not.toContain("wallet_addEthereumChain");
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
