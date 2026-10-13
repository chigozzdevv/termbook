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
  source: "eip6963" | "legacy";
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Provider;
};
export type Connection = { provider: Provider; address: `0x${string}`; chain: number };

export function preferredWallets(wallets: BrowserWallet[]): BrowserWallet[] {
  const announced = wallets.filter((wallet) => wallet.source === "eip6963");
  return announced.length ? announced : wallets;
}

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

export function walletErrorCode(error: unknown): number | undefined {
  let current = error;
  let code: number | undefined;
  for (let depth = 0; depth < 10 && current && typeof current === "object"; depth++) {
    const value = current as { code?: number; cause?: unknown };
    if (typeof value.code === "number") code = value.code;
    current = value.cause;
  }
  return code;
}

export type WalletOperation = "connecting" | "adding" | "switching" | "checking";

export function walletErrorMessage(error: unknown, operation: WalletOperation): string {
  const switching = operation === "switching";
  const adding = operation === "adding";
  switch (walletErrorCode(error)) {
    case 4001:
      return adding
        ? "Network addition declined. Click Add network to try again."
        : switching
          ? "Network switch declined. Retry or select Monad testnet in your wallet."
          : "Wallet connection declined. Choose your wallet to try again.";
    case -32002:
      return "A wallet request is already pending. Open your wallet and complete it, then check the network.";
    case 4200:
    case -32601:
      return adding
        ? "Your wallet cannot add this network automatically. Add Monad testnet in your wallet, then check the network."
        : switching
          ? "Your wallet cannot switch automatically. Select Monad testnet in your wallet, then check the network."
          : "Your wallet does not support this request. Choose another wallet.";
    case 4902:
      return "Monad testnet could not be added. Add it in your wallet or choose another wallet.";
    case 4100:
      return "Wallet access is not authorized. Reconnect and approve account access.";
    case 4900:
    case 4901:
      return "Your wallet is disconnected from the network. Open it and reconnect, then try again.";
    default:
      return adding
        ? "Monad testnet could not be added. Open your wallet and approve the network request, or add it manually."
        : switching
          ? "Network switch did not complete. Select Monad testnet in your wallet, then check the network, or choose another wallet."
          : operation === "checking"
            ? "Wallet state could not be read. Open your wallet and try again."
            : "Wallet connection did not complete. Open your wallet and approve account access, then retry.";
  }
}

export class WalletNetworkError extends Error {
  constructor(
    cause: unknown,
    readonly connection?: Connection,
  ) {
    super("Switch to Monad Testnet to continue.", { cause });
  }
}

async function confirmedConnection(provider: Provider, chain: Chain): Promise<Connection> {
  const connection = await readConnection(provider);
  if (!connection) throw new Error("No wallet account was selected.");
  if (connection.chain !== chain.id) throw new Error(`Switch to ${chain.name} to continue.`);
  return connection;
}

export async function switchWallet(
  provider: Provider,
  chain: Chain = monadTestnet,
): Promise<Connection> {
  const client = createWalletClient({
    chain,
    transport: custom(provider, { retryCount: 0 }),
  });
  try {
    if ((await client.getChainId()) !== chain.id) {
      try {
        await client.switchChain({ id: chain.id });
      } catch (error) {
        if (walletErrorCode(error) !== 4902) throw error;
        await client.addChain({ chain });
        await client.switchChain({ id: chain.id });
      }
    }
    return await confirmedConnection(provider, chain);
  } catch (error) {
    const connection = await readConnection(provider).catch(() => undefined);
    throw new WalletNetworkError(error, connection);
  }
}

export async function addWallet(
  provider: Provider,
  chain: Chain = monadTestnet,
  onSwitch?: () => void,
): Promise<Connection> {
  const client = createWalletClient({ chain, transport: custom(provider, { retryCount: 0 }) });
  try {
    await client.addChain({ chain });
    onSwitch?.();
    if ((await client.getChainId()) !== chain.id) await client.switchChain({ id: chain.id });
    return await confirmedConnection(provider, chain);
  } catch (error) {
    const connection = await readConnection(provider).catch(() => undefined);
    throw new WalletNetworkError(error, connection);
  }
}

export async function connectWallet(
  wallet: BrowserWallet,
  chain: Chain = monadTestnet,
  onSwitch?: () => void,
): Promise<Connection> {
  const client = createWalletClient({
    chain,
    transport: custom(wallet.provider, { retryCount: 0 }),
  });
  const accounts = await client.requestAddresses();
  if (!accounts.length) throw new Error("No wallet account was selected.");
  const connection = await readConnection(wallet.provider);
  if (!connection) throw new Error("No wallet account was selected.");
  if (connection.chain !== chain.id) {
    onSwitch?.();
    return switchWallet(wallet.provider, chain);
  }
  return connection;
}
