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

    function testRepaymentCannotBeRefundedWhileDebtRemains() public {
        receiver.setDebt(bytes32("c2"), 100);
        token.mint(address(inbox), 100);
        inbox.notifyAll();
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        inbox.refund(100);
        inbox.settle(100);
        assertEq(inbox.refunded(), 0);
    }

    function testBorrowerCannotCancelCreditInboxBeforeDelivery() public {
        vm.prank(address(3));
        vm.expectRevert(SettlementInbox.InvalidRecipient.selector);
        inbox.cancel();
        token.mint(address(inbox), 100);
        inbox.notifyAll();
        inbox.settle(100);
        assertEq(inbox.applied(), 100);
    }

    function testOverCapRecoveryCannotRefundUntrackedWhileDebtRemains() public {
        receiver.setDebt(bytes32("c2"), 1_000);
        token.mint(address(inbox), 1_001);
        inbox.notifyReceipt(1_000);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        inbox.refundUntracked(1);
        inbox.settle(1_000);
        assertEq(token.balanceOf(address(3)), 0);
        assertEq(inbox.applied(), 1_000);
    }

    function testExcessAfterReceiptCapReturnsOnlyToBoundRecipient() public {
        token.mint(address(inbox), 1_100);
        inbox.notifyReceipt(1_000);
        vm.warp(block.timestamp + 2 days);
        inbox.refundUntracked(100);
        assertEq(token.balanceOf(address(3)), 100);
        assertEq(inbox.available(), 1_000);
        assertEq(token.balanceOf(address(inbox)), 1_000);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        inbox.refundUntracked(1);
    }

    function testUntrackedFundsCannotBeRefundedBeforeDeadline() public {
        token.mint(address(inbox), 100);
        vm.expectRevert(SettlementInbox.Expired.selector);
        inbox.refundUntracked(100);
    }
}
