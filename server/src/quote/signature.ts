import { recoverAddress, recoverMessageAddress } from "viem";
import { monadClient } from "../chain/monad.client.js";

const erc1271Abi = [{ type: "function", name: "isValidSignature", stateMutability: "view",
  inputs: [{ type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bytes4" }] }] as const;
const magic = "0x1626ba7e";

export async function verifyHouseSignature(house: `0x${string}`, digest: `0x${string}`,
  signature: `0x${string}`): Promise<boolean> {
  const chain = monadClient();
  const block = await chain.getBlock({ blockTag: "finalized" });
  const code = await chain.getBytecode({ address: house, blockNumber: block.number });
  if (code && code !== "0x") {
    try {
      const result = await chain.readContract({ address: house, abi: erc1271Abi,
        functionName: "isValidSignature", args: [digest, signature], blockNumber: block.number });
      return result.toLowerCase() === magic;
    } catch {
      return false;
    }
  }
  if (signature.length !== 132) return false;
  const raw = await recoverAddress({ hash: digest, signature }).catch(() => undefined);
  if (raw?.toLowerCase() === house.toLowerCase()) return true;
  const personal = await recoverMessageAddress({ message: { raw: digest }, signature }).catch(() => undefined);
  return personal?.toLowerCase() === house.toLowerCase();
}
