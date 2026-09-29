// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppExitPlanner {
    function nextExitStep(bytes32 creditId, address account)
        external view returns (bytes32 stepId, bytes memory instruction, uint256 retryAt);
}
