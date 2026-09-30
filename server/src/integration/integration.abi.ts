import { decodeFunctionData, parseAbi, type Hex } from "viem";

export const coreActionAbi = parseAbi([
  "function executeAction(bytes32 creditId,address target,bytes data,uint256 amount,uint256 maxBound,uint256 borrowerNonce,uint256 deadline,bytes borrowerSig)",
  "function executeFundedAction(bytes32 creditId,address target,bytes data,uint256 drawAmount,uint256 spendAmount,uint256 maxBound,uint256 borrowerNonce,uint256 deadline,bytes borrowerSig)",
  "function executePlan(bytes32 creditId,(bytes32 capability,bytes32 market,(address target,address spendToken,uint256 spendAmount,bytes data)[] calls,uint256 requiredInput,uint256 exposureLimit) action,(uint256 drawAmount,uint256 maxDraw,uint256 nonce,uint256 deadline,uint256 revision,address signer,bytes signature) authorization)",
]);

export function decodeCoreAction(input: Hex) {
  const decoded = decodeFunctionData({ abi: coreActionAbi, data: input });
  if (decoded.functionName === "executePlan") {
    const [creditId, action] = decoded.args;
    if (action.calls.length === 0 || action.calls.length > 8) throw new Error("integration-action-evidence-invalid");
    return { creditId, functionName: decoded.functionName, capability: action.capability,
      calls: action.calls.map(({ target, data }) => ({ target, data })) };
  }
  const [creditId, target, data] = decoded.args;
  return { creditId, functionName: decoded.functionName, capability: null, calls: [{ target, data }] };
}
