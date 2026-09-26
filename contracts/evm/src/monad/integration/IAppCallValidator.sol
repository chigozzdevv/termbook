// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppCallValidator {
    function validateAction(bytes32 versionId, address target, bytes calldata data, address account, uint256 spendAmount)
        external
        view
        returns (bool);

    function validateRecovery(bytes32 versionId, address target, bytes calldata data, address account)
        external
        view
        returns (bool);
}
