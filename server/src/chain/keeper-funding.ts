import { parseAbi, parseTransaction, recoverTransactionAddress, type Address, type Hex, type PublicClient, type TransactionSerialized } from "viem";
import { base, baseSepolia } from "viem/chains";
import { estimateL1Fee } from "viem/op-stack";

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
  const address = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized });
  let value = request.value ?? 0n;
  if (request.chainId === 8453 || request.chainId === 84532) {
    if (await client.getChainId() !== request.chainId) throw new Error("keeper-chain-mismatch");
    if (!request.gas || request.gas < 0n) throw new Error("keeper-fee-request-invalid");
    const [l1Fee, operatorFee] = await Promise.all([
      estimateL1Fee(client, { account: address, chain: request.chainId === 8453 ? base : baseSepolia,
        ...(request.to ? { to: request.to } : {}), ...(request.data ? { data: request.data } : {}), value }),
      client.readContract({ address: "0x420000000000000000000000000000000000000F",
        abi: parseAbi(["function getOperatorFee(uint256) view returns(uint256)"]), functionName: "getOperatorFee", args: [request.gas] }),
    ]);
    value += l1Fee + operatorFee;
  }
  await assertKeeperFunding(client, address, { ...request, value });
}
