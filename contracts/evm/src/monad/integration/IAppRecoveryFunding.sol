// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppRecoveryFunding {
    function recoverySpend(bytes32 creditId, address account, bytes calldata instruction)
        external view returns (address token, uint256 amount);
}
