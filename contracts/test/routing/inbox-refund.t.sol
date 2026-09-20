// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementInbox} from "../../src/routing/SettlementInbox.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockSettlementReceiver} from "../MockSettlementReceiver.sol";

contract InboxRefundTest is Test {
    SettlementInbox inbox;
    MockERC20 token;
    MockSettlementReceiver receiver;

    function setUp() public {
        token = new MockERC20();
        receiver = new MockSettlementReceiver();
        inbox = new SettlementInbox(bytes32("op2"), address(receiver), address(token), bytes32("c2"), 0, 1_000, address(3), block.timestamp + 1 days);
    }

    function testRefundTracks() public {
        token.mint(address(inbox), 400);
        inbox.notifyReceipt(400);
        vm.warp(block.timestamp + 2 days);
        inbox.refund(400);
        assertEq(inbox.refunded(), 400);
    }

    function testSettleThenRefundRemainder() public {
        token.mint(address(inbox), 1000);
        inbox.notifyReceipt(1000);
        inbox.settle(600);
        vm.warp(block.timestamp + 2 days);
        inbox.refund(400);
        assertEq(inbox.applied() + inbox.refunded(), 1000);
    }
}
