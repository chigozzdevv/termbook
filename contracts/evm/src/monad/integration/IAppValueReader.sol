// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppValueReader {
    /// @dev Value and recovery costs use settlement-token base units; observedAt is the latest position observation.
    function readAppValue(bytes32 creditId, address account, address settlementAsset)
        external
        view
        returns (int256 netValue, uint16 retainedBps, uint128 recoveryCosts, uint256 observedAt);
}
