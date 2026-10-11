"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { monadTestnet } from "viem/chains";
import { evm_wallet, create_termbook, type TermbookClient, type TermbookModal, type OpenOptions } from "@termbook/sdk";
import { apiBase, type Market } from "./data";

type Provider = EIP1193Provider & { on?: (event: string, handler: () => void) => void; removeListener?: (event: string, handler: () => void) => void };
export type BrowserWallet = { info: { uuid: string; name: string }; provider: Provider };

export function useWallet(market?: Market) {
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [connection, setConnection] = useState<{ provider: Provider; address: `0x${string}`; chain: number }>();
  const [session, setSession] = useState<{ sdk: TermbookClient; connection: NonNullable<typeof connection> }>();
  const client = session?.connection === connection ? session?.sdk : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const modal = useRef<TermbookModal | null>(null);
  const connectLock = useRef(false);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    function announce(event: Event) {
      const detail = (event as CustomEvent<BrowserWallet>).detail;
      if (!detail?.provider?.request || typeof detail.info?.uuid !== "string" || typeof detail.info?.name !== "string") return;
      setWallets((rows) => [...rows.filter((row) => row.info.uuid !== detail.info.uuid), detail]);
    }
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = (window as Window & { ethereum?: Provider }).ethereum;
    let active = true;
    if (legacy) void legacy.request({ method: "eth_chainId" }).then(() => {
      if (active) setWallets((rows) => rows.some((row) => row.provider === legacy) ? rows : [...rows, { info: { uuid: "injected", name: "Browser wallet" }, provider: legacy }]);
    }).catch(() => undefined);
    return () => { active = false; window.removeEventListener("eip6963:announceProvider", announce); modal.current?.close(); };
  }, []);

  const connect = useCallback(async (wallet: BrowserWallet) => {
    if (connectLock.current) return;
    connectLock.current = true; setBusy(true); setError("");
    try {
      const viem = createWalletClient({ chain: monadTestnet, transport: custom(wallet.provider) });
      const [address] = await viem.requestAddresses();
      if (!address) throw new Error("No wallet account was selected.");
      let chain = await viem.getChainId();
      if (chain !== monadTestnet.id) {
        try { await viem.switchChain({ id: monadTestnet.id }); }
        catch (cause) {
          if ((cause as { code?: number; cause?: { code?: number } }).code !== 4902 && (cause as { cause?: { code?: number } }).cause?.code !== 4902) throw cause;
          await viem.addChain({ chain: monadTestnet });
          await viem.switchChain({ id: monadTestnet.id });
        }
        chain = await viem.getChainId();
      }
      modal.current?.close();
      setSession(undefined);
      setConnection({ provider: wallet.provider, address, chain });
    } catch { setError("Wallet connection was not completed. Connect on Monad testnet to continue."); }
    finally { connectLock.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    if (!connection) return;
    let active = true;
    const changed = () => {
      modal.current?.close(); setSession(undefined);
      void Promise.all([connection.provider.request({ method: "eth_accounts" }), connection.provider.request({ method: "eth_chainId" })])
        .then(([accounts, chain]) => {
          if (!active) return;
          const address = (accounts as string[])[0];
          setConnection(address ? { provider: connection.provider, address: address as `0x${string}`, chain: Number(chain) } : undefined);
        }).catch(() => { if (active) setConnection(undefined); });
    };
    connection.provider.on?.("accountsChanged", changed);
    connection.provider.on?.("chainChanged", changed);
    connection.provider.on?.("disconnect", changed);
    return () => {
      active = false;
      for (const event of ["accountsChanged", "chainChanged", "disconnect"]) connection.provider.removeListener?.(event, changed);
    };
  }, [connection]);

  useEffect(() => {
    if (!connection || connection.chain !== 10143 || !market?.app_token) return;
    let active = true;
    const init = async () => {
      const wallet = await evm_wallet(createWalletClient({ chain: monadTestnet, transport: custom(connection.provider) }));
      if (wallet.address.toLowerCase() !== connection.address.toLowerCase()) throw new Error("Wallet account changed. Reconnect.");
      const sdk = create_termbook({ app_token: market.app_token!, wallet, apiBase });
      await sdk.ready();
      const definition = sdk.config.integration_definition;
      if (sdk.config.chainId !== 10143 || definition?.use_case !== "spot"
        || sdk.config.versionId?.toLowerCase() !== market.version_id.toLowerCase()
        || definition.markets.length !== 1 || definition.markets[0].market_id !== market.market_id
        || sdk.config.settlementAsset?.toLowerCase() !== market.quote_asset.toLowerCase()) throw new Error("Integration configuration changed. Refresh before trading.");
      if (active) { setSession({ sdk, connection }); setError(""); }
    };
    void init().catch(() => { if (active) setError("Trading is temporarily unavailable. The integration checks did not pass. Retry connection."); });
    return () => { active = false; setSession(undefined); modal.current?.close(); };
  }, [connection, market?.app_token, market?.market_id, market?.quote_asset, market?.version_id, revision]);

  const disconnect = useCallback(() => { modal.current?.close(); setSession(undefined); setConnection(undefined); setError(""); }, []);
  const open = useCallback(async (options: OpenOptions) => {
    if (!client) return;
    modal.current?.close();
    modal.current = client.open(options);
    await modal.current.ready;
  }, [client]);
  return { wallets: wallets.filter((wallet) => wallet.info.uuid !== "injected" || wallets.length === 1), connection, client, busy, error, connect, disconnect, open, refresh };
}
