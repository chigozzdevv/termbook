import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../src/features/wallet/connection";
import { Create } from "../src/features/houses/create";

let wallet: {
  connection?: Connection;
  busy: boolean;
  error: string;
  wallets: [];
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
});
