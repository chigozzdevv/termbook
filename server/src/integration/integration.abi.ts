import { decodeFunctionData, parseAbi, type Hex } from "viem";

export const coreActionAbi = parseAbi([
  "struct ExecutionCall { address target; address spendToken; uint256 spendAmount; bytes data; uint256 nativeValue; }",
  "struct ExecutionAction { bytes32 capability; bytes32 market; ExecutionCall[] calls; uint256 requiredInput; uint256 exposureLimit; }",
  "struct ExecutionPrice { uint80 roundId; uint256 referencePrice; uint256 updatedAt; uint256 authorizedAt; uint256 bound; uint16 slippageBps; bool isMax; }",
  "struct ExecutionAuthorization { uint256 drawAmount; uint256 maxDraw; uint256 nonce; uint256 deadline; uint256 revision; address signer; bytes signature; ExecutionPrice price; }",
  "function executeAction(bytes32 creditId,address target,bytes data,uint256 amount,uint256 maxBound,uint256 borrowerNonce,uint256 deadline,bytes borrowerSig)",
  "function executeFundedAction(bytes32 creditId,address target,bytes data,uint256 drawAmount,uint256 spendAmount,uint256 maxBound,uint256 borrowerNonce,uint256 deadline,bytes borrowerSig)",
  "function executePlan(bytes32 creditId,ExecutionAction action,ExecutionAuthorization authorization)",
]);

export function decodeCoreAction(input: Hex) {
  const decoded = decodeFunctionData({ abi: coreActionAbi, data: input });
  if (decoded.functionName === "executePlan") {
    const [creditId, action] = decoded.args;
    if (action.calls.length === 0 || action.calls.length > 8) throw new Error("integration-action-evidence-invalid");
    return { creditId, functionName: decoded.functionName, capability: action.capability,
      calls: action.calls.map(({ target, data, nativeValue }) => ({ target, data, nativeValue })) };
  }
  const [creditId, target, data] = decoded.args;
  return { creditId, functionName: decoded.functionName, capability: null, calls: [{ target, data, nativeValue: 0n }] };
}
