// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRegisteredAccount {
    function creditId() external view returns (bytes32);
    function borrower() external view returns (address);
}

contract CreditRegistry {
    mapping(bytes32 => address) public accountOf;
    mapping(bytes32 => address) public borrowerOf;
    mapping(bytes32 => address) public houseOf;
    error Exists();
    error Invalid();

    function register(bytes32 creditId, address borrower, address house, address account) external {
        if (creditId == bytes32(0) || borrower == address(0) || house == address(0) || account.code.length == 0) revert Invalid();
        if (accountOf[creditId] != address(0)) revert Exists();
        if (IRegisteredAccount(account).creditId() != creditId || IRegisteredAccount(account).borrower() != borrower) revert Invalid();
        accountOf[creditId] = account;
        borrowerOf[creditId] = borrower;
        houseOf[creditId] = house;
    }
}
