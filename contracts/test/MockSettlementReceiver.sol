// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockSettlementReceiver {
    mapping(bytes32 => uint256) public creditDebt;
    bytes32 public lastOperationId;
    bytes32 public lastCreditId;
    address public lastToken;
    uint256 public lastAmount;

    function core() external view returns (address) {
        return address(this);
    }

    function setDebt(bytes32 creditId, uint256 amount) external {
        creditDebt[creditId] = amount;
    }

    function onSettlement(bytes32 operationId, bytes32 creditId, address token, uint256 amount) external {
        lastOperationId = operationId;
        lastCreditId = creditId;
        lastToken = token;
        lastAmount = amount;
    }
}
