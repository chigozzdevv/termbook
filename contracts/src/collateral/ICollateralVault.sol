// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICollateralVault {
    function asset() external view returns (address);
    function chainId_() external view returns (uint256);
    function core() external view returns (address);
    function lock(bytes32 lockId, bytes32 creditId, address owner, uint256 amount, address recipient) external;
    function release(bytes32 lockId, address recipient, uint256 amount, uint256 nonce) external;
    function seize(bytes32 lockId, address recipient, uint256 amount) external;
    function lockInfo(bytes32 lockId) external view returns (bytes32, address, address, uint256, uint256, address, uint256, uint256, bool, bool, bool);
    function consumed(bytes32 lockId) external view returns (bool);
}
