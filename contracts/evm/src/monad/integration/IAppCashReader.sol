// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppCashReader {
    function reservedCash(bytes32 creditId, address account, address settlementAsset)
        external view returns (uint256 amount, uint256 observedAt);
}
