// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockSettlementReceiver {
    bytes32 public lastOperationId;
    bytes32 public lastCreditId;
    address public lastToken;
    uint256 public lastAmount;

    function onSettlement(bytes32 operationId, bytes32 creditId, address token, uint256 amount) external {
        lastOperationId = operationId;
        lastCreditId = creditId;
        lastToken = token;
        lastAmount = amount;
    }
}
