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
  switchWallet,
  WalletNetworkError,
  walletErrorMessage,
  type BrowserWallet,
  type Connection,
  type Provider,
  type WalletOperation,
} from "./connection";
import { legacyInfo } from "./branding";

function useWalletSession() {
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [provider, setProvider] = useState<Provider>();
  const [connection, setConnection] = useState<Connection>();
  const [phase, setPhase] = useState<WalletOperation>();
  const busy = phase !== undefined;
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

  const perform = useCallback(
    async (target: Provider, operation: WalletOperation, wallet?: BrowserWallet) => {
      if (pending.current) return false;
      pending.current = true;
      const current = invalidate();
      let stage = operation;
      setPhase(stage);
      setError("");
      setConnection(undefined);
      setProvider(target);
      try {
        const next = wallet
          ? await connectWallet(wallet, undefined, () => {
              stage = "switching";
              if (mounted.current && current === revision.current) setPhase(stage);
            })
          : operation === "switching"
            ? await switchWallet(target)
            : await readConnection(target);
        if (!mounted.current || current !== revision.current) return false;
        setConnection(next);
        if (next && next.chain !== 10143)
          setError("Your wallet is still on another network. Switch to Monad testnet to continue.");
        else if (!next) setError("No wallet account is connected. Reconnect to continue.");
        return next?.chain === 10143;
      } catch (error) {
        if (mounted.current && current === revision.current) {
          if (error instanceof WalletNetworkError) setConnection(error.connection);
          else if (operation === "connecting") setProvider(undefined);
          setError(walletErrorMessage(error, stage));
        }
        return false;
      } finally {
        pending.current = false;
        if (mounted.current) setPhase(undefined);
      }
    },
    [invalidate],
  );

  const connect = useCallback(
    (wallet: BrowserWallet) => perform(wallet.provider, "connecting", wallet),
    [perform],
  );
  const switchNetwork = useCallback(
    () => (provider ? perform(provider, "switching") : Promise.resolve(false)),
    [provider, perform],
  );
  const checkNetwork = useCallback(
    () => (provider ? perform(provider, "checking") : Promise.resolve(false)),
    [provider, perform],
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
    phase,
    error,
    connect,
    switchNetwork,
    checkNetwork,
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
