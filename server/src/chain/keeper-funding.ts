import { parseTransaction, recoverTransactionAddress, type Address, type Hex, type PublicClient, type TransactionSerialized } from "viem";

type FeeRequest = { gas?: bigint; gasPrice?: bigint; maxFeePerGas?: bigint; value?: bigint };

export async function assertKeeperFunding(client: PublicClient, address: Address, request: FeeRequest): Promise<void> {
  const fee = request.maxFeePerGas ?? request.gasPrice;
  if (request.gas === undefined || request.gas <= 0n || fee === undefined || fee < 0n
    || (request.value ?? 0n) < 0n) throw new Error("keeper-fee-request-invalid");
  const required = request.gas * fee + (request.value ?? 0n);
  const balance = await client.getBalance({ address, blockTag: "latest" });
  if (balance < required) {
    throw new Error(`keeper-funding-insufficient: wallet=${address} requiredWei=${required} balanceWei=${balance}`);
  }
}

export async function assertSignedKeeperFunding(client: PublicClient, raw: Hex): Promise<void> {
  const request = parseTransaction(raw);
  await assertKeeperFunding(client, await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized }), request);
}
