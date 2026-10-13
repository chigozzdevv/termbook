"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  connectWallet,
  readConnection,
  preferredWallets,
  type BrowserWallet,
  type Connection,
  type Provider,
} from "./connection";
import { legacyInfo } from "./branding";

function useWalletSession() {
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [provider, setProvider] = useState<Provider>();
  const [connection, setConnection] = useState<Connection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);
  const invalidate = useCallback(() => ++revision.current, []);

  useEffect(() => {
    mounted.current = true;
    function announce(event: Event) {
      const wallet = (event as CustomEvent<Omit<BrowserWallet, "source">>).detail;
      if (
        typeof wallet?.provider?.request !== "function" ||
        typeof wallet.info?.uuid !== "string" ||
        typeof wallet.info?.name !== "string"
      )
        return;
      setWallets((rows) => [
        ...rows.filter(
          (row) => row.info.uuid !== wallet.info.uuid && row.provider !== wallet.provider,
        ),
        { source: "eip6963", info: wallet.info, provider: wallet.provider },
      ]);
    }
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const legacy = (window as Window & { ethereum?: Provider }).ethereum;
    let active = true;
    if (typeof legacy?.request === "function")
      void legacy
        .request({ method: "eth_chainId" })
        .then(() => {
          if (active)
            setWallets((rows) =>
              rows.some((row) => row.provider === legacy)
                ? rows
                : [...rows, { source: "legacy", info: legacyInfo(legacy), provider: legacy }],
            );
        })
        .catch(() => undefined);
    return () => {
      active = false;
      mounted.current = false;
      invalidate();
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, [invalidate]);

  const connect = useCallback(
    async (wallet: BrowserWallet) => {
      if (pending.current) return false;
      pending.current = true;
      const current = invalidate();
      setBusy(true);
      setError("");
      setConnection(undefined);
      setProvider(wallet.provider);
      try {
        const next = await connectWallet(wallet);
        if (!mounted.current || current !== revision.current) return false;
        setConnection(next);
        return true;
      } catch {
        if (mounted.current && current === revision.current) {
          setProvider(undefined);
          setError("Wallet connection was not completed. Connect on Monad testnet to continue.");
        }
        return false;
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [invalidate],
  );

  const disconnect = useCallback(() => {
    invalidate();
    setProvider(undefined);
    setConnection(undefined);
    setError("");
  }, [invalidate]);

  useEffect(() => {
    if (!provider) return;
    let active = true;
    const changed = () => {
      setConnection(undefined);
      if (pending.current) return;
      const current = invalidate();
      void readConnection(provider)
        .then((next) => {
          if (active && current === revision.current) {
            setConnection(next);
            setError("");
          }
        })
        .catch(() => {
          if (active && current === revision.current)
            setError("Wallet state could not be read. Reconnect to continue.");
        });
    };
    provider.on?.("accountsChanged", changed);
    provider.on?.("chainChanged", changed);
    provider.on?.("disconnect", disconnect);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", changed);
      provider.removeListener?.("chainChanged", changed);
      provider.removeListener?.("disconnect", disconnect);
    };
  }, [provider, disconnect, invalidate]);

  return {
    wallets: preferredWallets(wallets),
    connection,
    busy,
    error,
    connect,
    disconnect,
  };
}

type WalletState = ReturnType<typeof useWalletSession>;
const Context = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletSession();
  return <Context.Provider value={wallet}>{children}</Context.Provider>;
}

export function useWallet(): WalletState {
  const wallet = useContext(Context);
  if (!wallet) throw new Error("Wallet provider is missing.");
  return wallet;
}
