import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWallet, Connection } from "../src/features/wallet/connection";
import { Create } from "../src/features/houses/create";
import { Picker } from "../src/features/wallet/picker";

let wallet: {
  connection?: Connection;
  busy: boolean;
  error: string;
  wallets: BrowserWallet[];
  connect: () => Promise<boolean>;
  disconnect: () => void;
};
vi.mock("../src/features/wallet/use-wallet", () => ({ useWallet: () => wallet }));

const connected: Connection = {
  address: "0x1111111111111111111111111111111111111111",
  chain: 10143,
  provider: { request: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
};

describe("House creation wallet gate", () => {
  beforeEach(() => {
    wallet = {
      busy: false,
      error: "",
      wallets: [],
      connect: async () => false,
      disconnect: vi.fn(),
    };
  });

  it("requires connection before exposing the House form on a direct visit", () => {
    const html = renderToStaticMarkup(createElement(Create));
    expect(html).toContain("Connect your Monad wallet to continue.");
    expect(html).toContain('id="house-wallet"');
    expect(html).not.toContain('aria-label="Lending asset"');
    expect(html).not.toContain('aria-label="Initial liquidity"');
  });

  it("opens the form for a connected Monad wallet and moves account controls to the header", () => {
    wallet.connection = connected;
    const html = renderToStaticMarkup(createElement(Create));
    expect(html).toContain('aria-label="Lending asset"');
    expect(html).toContain('aria-label="Initial liquidity"');
    expect(html).toContain('aria-label="Connected manager wallet"');
    expect(html).toContain(`title="${connected.address}"`);
    expect(html).toContain('aria-label="Change manager wallet"');
    expect(html).toContain('aria-label="Disconnect manager wallet"');
    expect(html).not.toContain("manager-wallet-label");
  });

  it("hides the form when the connected wallet switches to another chain", () => {
    wallet.connection = { ...connected, chain: 1 };
    const html = renderToStaticMarkup(createElement(Create));
    expect(html).toContain("Switch to Monad testnet to continue.");
    expect(html).not.toContain('aria-label="Initial liquidity"');
  });

  it("hides the form while a wallet change is being confirmed", () => {
    wallet.connection = connected;
    wallet.busy = true;
    const html = renderToStaticMarkup(createElement(Create));
    expect(html).toContain("Connecting…");
    expect(html).not.toContain('aria-label="Initial liquidity"');
  });

  it("shows missing wallets as branded download links", () => {
    const html = renderToStaticMarkup(
      createElement(Picker, { id: "test-wallet", open: true, onClose: vi.fn() }),
    );
    expect(html).toContain('aria-label="Get MetaMask"');
    expect(html).toContain('href="https://metamask.io/download"');
    expect(html).toContain('src="/wallets/metamask.svg"');
    expect(html).toContain('src="/wallets/rabby.svg"');
    expect(html).not.toContain('aria-label="Connect MetaMask"');
  });

  it("shows detected wallets as connection buttons with logos instead of duplicate installation links", () => {
    wallet.wallets = [
      {
        source: "eip6963",
        info: {
          uuid: "metamask",
          name: "MetaMask",
          rdns: "io.metamask",
          icon: "https://example.com/tracking.png",
        },
        provider: connected.provider,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(Picker, { id: "test-wallet", open: true, onClose: vi.fn() }),
    );
    expect(html).toContain('aria-label="Connect MetaMask"');
    expect(html).toContain("Installed");
    expect(html).toContain('src="/wallets/metamask.svg"');
    expect(html).not.toContain("tracking.png");
    expect(html).not.toContain('aria-label="Get MetaMask"');
  });
});
