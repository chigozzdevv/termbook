import {
  createWalletClient,
  custom,
  getAddress,
  isAddress,
  type Chain,
  type EIP1193Provider,
} from "viem";
import { monadTestnet } from "viem/chains";

export type Provider = EIP1193Provider & {
  on?: (event: string, handler: () => void) => void;
  removeListener?: (event: string, handler: () => void) => void;
};
export type BrowserWallet = {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Provider;
};
export type Connection = { provider: Provider; address: `0x${string}`; chain: number };

export async function readConnection(provider: Provider): Promise<Connection | undefined> {
  let revision = 0;
  const changed = () => {
    revision++;
  };
  const events = ["accountsChanged", "chainChanged", "disconnect"];
  for (const event of events) provider.on?.(event, changed);
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = revision;
      const accounts = await provider.request({ method: "eth_accounts" });
      const address = accounts[0];
      if (!address) return;
      if (!isAddress(address) || /^0x0{40}$/i.test(address))
        throw new Error("Invalid wallet account.");
      const chain = Number(await provider.request({ method: "eth_chainId" }));
      if (!Number.isSafeInteger(chain) || chain <= 0) throw new Error("Invalid wallet network.");
      if (current === revision) return { provider, address: getAddress(address), chain };
    }
    throw new Error("Wallet account or network changed. Reconnect to continue.");
  } finally {
    for (const event of events) provider.removeListener?.(event, changed);
  }
}

function missingChain(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth++) {
    const value = current as { code?: number; cause?: unknown };
    if (value.code === 4902) return true;
    current = value.cause;
  }
  return false;
}

export async function connectWallet(
  wallet: BrowserWallet,
  chain: Chain = monadTestnet,
): Promise<Connection> {
  const client = createWalletClient({
    chain,
    transport: custom(wallet.provider, { retryCount: 0 }),
  });
  const accounts = await client.requestAddresses();
  if (!accounts.length) throw new Error("No wallet account was selected.");
  if ((await client.getChainId()) !== chain.id) {
    try {
      await client.switchChain({ id: chain.id });
    } catch (error) {
      if (!missingChain(error)) throw error;
      await client.addChain({ chain });
      await client.switchChain({ id: chain.id });
    }
  }
  const connection = await readConnection(wallet.provider);
  if (!connection) throw new Error("No wallet account was selected.");
  if (connection.chain !== chain.id) throw new Error(`Switch to ${chain.name} to continue.`);
  return connection;
}
