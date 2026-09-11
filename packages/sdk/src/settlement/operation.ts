import { encodeAbiParameters, keccak256 } from "viem";

export type OperationKind = "repay" | "recovery" | "lp_deposit";

export type OperationInput = {
  kind: OperationKind;
  payer: `0x${string}`;
  nonce: bigint;
  chainId: number;
  creditId?: `0x${string}`;
  routeVersion?: `0x${string}`;
  asset?: `0x${string}`;
  vault?: `0x${string}`;
};

export function operationId(input: OperationInput): `0x${string}`;
export function operationId(kind: OperationKind, payer: `0x${string}`, nonce: bigint, chainId: number): `0x${string}`;
export function operationId(
  kindOrInput: OperationKind | OperationInput,
  payer?: `0x${string}`,
  nonce?: bigint,
  chainId?: number,
): `0x${string}` {
  const input: OperationInput = typeof kindOrInput === "string"
    ? { kind: kindOrInput, payer: payer as `0x${string}`, nonce: nonce as bigint, chainId: chainId as number }
    : kindOrInput;
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.payer) || input.nonce < 0n || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error("param-invalid");
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
  return keccak256(encodeAbiParameters(
    [
      { type: "string" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
    ],
    [input.kind, input.payer, input.nonce, BigInt(input.chainId), input.creditId ?? zero, input.routeVersion ?? zero, input.asset ?? "0x0000000000000000000000000000000000000000", input.vault ?? "0x0000000000000000000000000000000000000000"],
  ));
}

export function operationKey(operationId_: `0x${string}`, nonce: bigint): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(operationId_) || nonce < 0n) throw new Error("param-invalid");
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [operationId_, nonce]));
}

export function checkQuoteForOperation(minOut: bigint, quotedOut: bigint, maxIn: bigint, amountIn: bigint): void {
  if (minOut < 0n || quotedOut < 0n || maxIn < 0n || amountIn < 0n) throw new Error("param-invalid");
  if (amountIn > maxIn) throw new Error("draw-capped");
  if (quotedOut < minOut) throw new Error("settle-failed");
}
