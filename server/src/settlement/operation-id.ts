import { encodeAbiParameters, keccak256 } from "viem";

type OperationKind = "repay" | "recovery" | "lp_deposit";

const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export function deriveOperationId(input: {
  kind: OperationKind;
  payer: string;
  nonce: bigint;
  chainId: number;
  creditId?: string;
  routeVersion?: string;
  sourceAsset: string;
  vault: string;
}): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
      ],
      [
        input.kind,
        input.payer as `0x${string}`,
        input.nonce,
        BigInt(input.chainId),
        (input.creditId ?? zeroBytes32) as `0x${string}`,
        (input.routeVersion ?? zeroBytes32) as `0x${string}`,
        input.sourceAsset as `0x${string}`,
        input.vault as `0x${string}`,
      ],
    ),
  );
}
