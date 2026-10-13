"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { monadTestnet } from "viem/chains";
import { evm_wallet, create_termbook, type TermbookClient, type TermbookModal, type OpenOptions } from "@termbook/sdk";
import { apiBase, type Market } from "./data";
import { useWallet as useConnection } from "@/features/wallet/use-wallet";

export function useWallet(market?: Market) {
  const { wallets, connection, busy, error: connectionError, connect, switchNetwork, disconnect: disconnectWallet } = useConnection();
  const [session, setSession] = useState<{ sdk: TermbookClient; connection: NonNullable<typeof connection> }>();
  const provider = connection?.provider;
  const address = connection?.address;
  const client = session?.connection.provider === provider && session?.connection.address === address
    && connection?.chain === 10143 ? session?.sdk : undefined;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const modal = useRef<TermbookModal | null>(null);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => () => { modal.current?.close(); }, []);

  useEffect(() => {
    if (!provider || !address || !market?.app_token) return;
    let active = true;
    const init = async () => {
      const wallet = await evm_wallet(createWalletClient({ chain: monadTestnet, transport: custom(provider, { retryCount: 0 }) }));
      if (wallet.address.toLowerCase() !== address.toLowerCase()) throw new Error("Wallet account changed. Reconnect.");
      const sdk = create_termbook({ app_token: market.app_token!, wallet, apiBase });
      await sdk.ready();
      const definition = sdk.config.integration_definition;
      if (sdk.config.chainId !== 10143 || definition?.use_case !== "spot"
        || sdk.config.versionId?.toLowerCase() !== market.version_id.toLowerCase()
        || definition.markets.length !== 1 || definition.markets[0].market_id !== market.market_id
        || sdk.config.settlementAsset?.toLowerCase() !== market.quote_asset.toLowerCase()) throw new Error("Integration configuration changed. Refresh before trading.");
      if (active) { setSession({ sdk, connection: { provider, address, chain: 10143 } }); setError(""); }
    };
    void init().catch(() => { if (active) setError("Trading is temporarily unavailable. The integration checks did not pass. Retry connection."); });
    return () => { active = false; setSession(undefined); modal.current?.close(); };
  }, [provider, address, market?.app_token, market?.market_id, market?.quote_asset, market?.version_id, revision]);

  const disconnect = useCallback(() => { modal.current?.close(); setSession(undefined); disconnectWallet(); setError(""); }, [disconnectWallet]);
  const open = useCallback(async (options: OpenOptions) => {
    if (!client) return;
    modal.current?.close();
    modal.current = client.open(options);
    await modal.current.ready;
  }, [client]);
  return { wallets, connection, client, busy, error: connectionError || error, connect, switchNetwork, disconnect, open, refresh };
}
