import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi, stringToHex, type Hex } from "viem";

export const evmActionAbi = parseAbi([
  "function execute((uint256 monadChain,address monadCore,uint256 sourceChain,address sourceVault,bytes32 creditId,bytes32 lockId,address asset,uint8 kind,address recipient,uint256 amount,uint256 nonce,uint256 deadline),bytes header,bytes proof)",
  "function consumed(bytes32) view returns (bool)",
]);
export type EvmAction = { monadChain: bigint; monadCore: Hex; sourceChain: bigint; sourceVault: Hex;
  creditId: Hex; lockId: Hex; asset: Hex; kind: number; recipient: Hex; amount: bigint; nonce: bigint; deadline: bigint };
export function evmActionHash(a: EvmAction): Hex {
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" },
    { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" },
    { type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
  ], [keccak256(stringToHex("Termbook remote collateral action v1")), a.monadChain, a.monadCore,
    a.sourceChain, a.sourceVault, a.creditId, a.lockId, a.asset, a.kind, a.recipient, a.amount, a.nonce, a.deadline]));
}
export function parseEvmActionPlan(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("source-action-plan-invalid");
  const v = value as Record<string, unknown>, tx = v["transaction"] as Record<string, unknown> | undefined;
  if (!tx || typeof tx["to"] !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(tx["to"])
    || typeof tx["data"] !== "string" || !/^0x(?:[a-fA-F0-9]{2})+$/.test(tx["data"])
    || typeof v["actionHash"] !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(v["actionHash"])) throw new Error("source-action-plan-invalid");
  const decoded = decodeFunctionData({ abi: evmActionAbi, data: tx["data"] as Hex });
  if (decoded.functionName !== "execute") throw new Error("source-action-plan-invalid");
  const [action, header, proof] = decoded.args;
  if (action.kind !== 2 || action.amount <= 0n || action.nonce <= 0n
    || evmActionHash(action).toLowerCase() !== v["actionHash"].toLowerCase()) throw new Error("source-action-plan-invalid");
  return { action, header, proof, controller: tx["to"] as Hex, actionHash: v["actionHash"] as Hex };
}
