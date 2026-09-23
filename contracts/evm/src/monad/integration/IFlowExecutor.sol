// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFlowExecutor {
    function runFlow(bytes32 creditId, bytes32 flowId, bytes calldata data) external;
}
