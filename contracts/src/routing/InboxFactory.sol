// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SettlementInbox} from "./SettlementInbox.sol";

contract InboxFactory {
    address public immutable governance;
    address public registrar;
    mapping(bytes32 => address) public inboxOf;
    error Unauthorized();
    error Replay();
    error Invalid();

    event InboxCreated(bytes32 indexed operationId, address inbox);
    event RegistrarSet(address indexed registrar);

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
        registrar = governance_;
    }

    function setRegistrar(address registrar_) external {
        if (msg.sender != governance || registrar_ == address(0)) revert Unauthorized();
        registrar = registrar_;
        emit RegistrarSet(registrar_);
    }

    function create(
        bytes32 operationId,
        address vault,
        address token,
        bytes32 creditId,
        uint256 minOut,
        uint256 maxReceived,
        address refundRecipient,
        uint256 deadline
    ) external returns (address inbox) {
        if (msg.sender != registrar) revert Unauthorized();
        if (inboxOf[operationId] != address(0)) revert Replay();
        if (
            operationId == bytes32(0) || vault.code.length == 0 || token.code.length == 0
                || refundRecipient == address(0) || maxReceived == 0 || minOut > maxReceived
        ) revert Invalid();
        inbox = address(new SettlementInbox(operationId, vault, token, creditId, minOut, maxReceived, refundRecipient, deadline));
        inboxOf[operationId] = inbox;
        emit InboxCreated(operationId, inbox);
    }
}
