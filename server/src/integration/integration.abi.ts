import { parseAbi } from "viem";

export const coreActionAbi = parseAbi([
  "function executeAction(bytes32 creditId,address target,bytes data,uint256 amount,uint256 maxBound,uint256 borrowerNonce,uint256 deadline,bytes borrowerSig)",
  "function executeFundedAction(bytes32 creditId,address target,bytes data,uint256 drawAmount,uint256 spendAmount,uint256 maxBound,uint256 borrowerNonce,uint256 deadline,bytes borrowerSig)",
]);
