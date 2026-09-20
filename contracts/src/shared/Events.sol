// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Events {
    event CreditCreated(bytes32 indexed creditId, bytes32 indexed intentId, address borrower, address house);
    event CreditReady(bytes32 indexed creditId);
    event CreditAborted(bytes32 indexed creditId);
    event Drawn(bytes32 indexed creditId, uint256 amount, uint256 debt);
    event Repaid(bytes32 indexed creditId, uint256 amount, uint256 debt);
    event Closed(bytes32 indexed creditId);
    event LiquidationStarted(bytes32 indexed creditId);
    event Cured(bytes32 indexed creditId);
    event Liquidated(bytes32 indexed creditId);
    event RecoveryPayment(bytes32 indexed creditId, uint256 amount, uint256 debt);
    event CollateralBound(bytes32 indexed creditId, bytes32 lockId, uint256 amount);
    event CollateralReturned(bytes32 indexed creditId, bytes32 lockId, uint256 amount);
    event RemoteReturnRequested(bytes32 indexed creditId, bytes32 lockId, uint256 amount, address recipient);
    event InboxSettled(bytes32 indexed operationId, uint256 amount);
    event InboxRefunded(bytes32 indexed operationId, uint256 amount);
}
