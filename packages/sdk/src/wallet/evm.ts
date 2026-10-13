import type { Abi, WalletClient } from "viem";
import type { Wallet } from "../types/client.types.js";

export async function evm_wallet(client: WalletClient): Promise<Wallet> {
  const [address] = await client.getAddresses();
  if (!address) throw new Error("wallet-not-connected");
  const checkAccount = async () => {
    const [current] = await client.getAddresses();
    if (current?.toLowerCase() !== address.toLowerCase()) throw new Error("wallet-account-mismatch");
  };

  return {
    address,
    ...(client.request ? { request: (request: { method: string; params?: unknown[] }) => client.request(request as never) } : {}),
    getChainId: () => client.getChainId(),
    signMessage: async (message) => { await checkAccount(); return client.signMessage({ account: address, message }); },
    signTypedData: async (payload) => {
      await checkAccount();
      return client.signTypedData({ ...(payload as Parameters<typeof client.signTypedData>[0]), account: address });
    },
    writeContract: (request) => {
      if (request.account.toLowerCase() !== address.toLowerCase()) throw new Error("wallet-account-mismatch");
      return checkAccount().then(() => client.writeContract({ ...request, abi: request.abi as Abi, chain: client.chain, account: address }));
    },
  };
}
