// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ExecutionManager} from "./ExecutionManager.sol";
import {ExecutionTypes} from "./IExecutionPolicy.sol";

interface IFlowExecutor {
    function prepare(bytes32 creditId, bytes32 bundleId, address account, ExecutionTypes.Action calldata action)
        external returns (ExecutionManager.Reservation memory);
    function complete(bytes32 creditId, bytes32 bundleId, address account, ExecutionTypes.Action calldata action,
        ExecutionManager.Reservation calldata reservation, bytes[] calldata results) external;
    function sync(bytes32 creditId, bytes32 bundleId, address account) external returns (bool);
    function policyHash(bytes32 bundleId) external view returns (bytes32);
    function pendingCount(bytes32 creditId) external view returns (uint256);
    function pendingAt(bytes32 creditId, uint256 index) external view returns (bytes32);
}
