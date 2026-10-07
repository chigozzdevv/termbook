// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppRecoveryAdapter {
    function recoveryCall(bytes32 creditId, address account, bytes calldata instruction)
        external
        view
        returns (address target, bytes memory data, uint256 nativeValue, bytes32 expectedState);

    function verifyRecovery(bytes32 creditId, address account, bytes calldata instruction, bytes32 expectedState)
        external
        view
        returns (bool);
}
