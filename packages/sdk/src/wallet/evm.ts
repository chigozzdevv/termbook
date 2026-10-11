import type { Abi, WalletClient } from "viem";
import type { Wallet } from "../types/client.types.js";

export async function evm_wallet(client: WalletClient): Promise<Wallet> {
  const [address] = await client.getAddresses();
  if (!address) throw new Error("wallet-not-connected");

  return {
    address,
    getChainId: () => client.getChainId(),
    signMessage: (message) => client.signMessage({ account: address, message }),
    signTypedData: (payload) => client.signTypedData({
      ...(payload as Parameters<typeof client.signTypedData>[0]),
      account: address,
    }),
    writeContract: (request) => {
      if (request.account.toLowerCase() !== address.toLowerCase()) throw new Error("wallet-account-mismatch");
      return client.writeContract({ ...request, abi: request.abi as Abi, chain: client.chain, account: address });
    },
  };
}
