// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CreditAccount} from "./CreditAccount.sol";

contract AccountFactory {
    mapping(bytes32 => address) public accountOf;
    event AccountCreated(bytes32 indexed creditId, address account, address borrower);
    error Exists();
    error Invalid();

    function create(bytes32 creditId, address borrower, address core) external returns (address account) {
        if (creditId == bytes32(0) || borrower == address(0) || core == address(0)) revert Invalid();
        if (msg.sender != borrower) revert Invalid();
        if (accountOf[creditId] != address(0)) revert Exists();
        account = address(new CreditAccount(creditId, borrower, core));
        accountOf[creditId] = account;
        emit AccountCreated(creditId, account, borrower);
    }
}
