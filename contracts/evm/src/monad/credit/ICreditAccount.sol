// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICreditAccount {
    function creditId() external view returns (bytes32);
    function borrower() external view returns (address);
    function execute(address target, bytes calldata data) external returns (bytes memory);
    function executeWithValue(address target, bytes calldata data, uint256 value) external returns (bytes memory);
    function approveSpend(address token, address spender, uint256 amount) external;
}
