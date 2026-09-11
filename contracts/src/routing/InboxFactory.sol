// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SettlementInbox} from "./SettlementInbox.sol";

contract InboxFactory {
    address public immutable governance;
    mapping(bytes32 => address) public inboxOf;
    error Unauthorized();
    error Replay();
    error Invalid();

    event InboxCreated(bytes32 indexed operationId, address inbox);

    constructor() {
        governance = msg.sender;
    }

    function create(
        bytes32 operationId,
        address vault,
        address token,
        bytes32 creditId,
        uint256 minOut,
        address refundRecipient,
        uint256 deadline
    ) external returns (address inbox) {
        if (msg.sender != governance) revert Unauthorized();
        if (inboxOf[operationId] != address(0)) revert Replay();
        if (operationId == bytes32(0) || vault.code.length == 0 || token.code.length == 0 || refundRecipient == address(0)) revert Invalid();
        inbox = address(new SettlementInbox(operationId, vault, token, creditId, minOut, refundRecipient, deadline));
        inboxOf[operationId] = inbox;
        emit InboxCreated(operationId, inbox);
    }
}
