// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementInbox} from "../../src/routing/SettlementInbox.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockSettlementReceiver} from "../MockSettlementReceiver.sol";

contract InboxSettlementTest is Test {
    SettlementInbox inbox;
    MockERC20 token;
    MockSettlementReceiver receiver;

    function setUp() public {
        token = new MockERC20();
        receiver = new MockSettlementReceiver();
        inbox = new SettlementInbox(bytes32("op1"), address(receiver), address(token), bytes32("c1"), 0, 2_000, address(3), block.timestamp + 1 days);
        token.mint(address(inbox), 1000);
    }

    function testSettleTracks() public {
        inbox.notifyReceipt(1000);
        inbox.settle(900);
        assertEq(inbox.applied(), 900);
    }

    function testDoubleSettleReverts() public {
        token.mint(address(inbox), 500);
        inbox.notifyReceipt(500);
        inbox.settle(500);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        inbox.settle(1);
    }

    function testMinOutEnforced() public {
        SettlementInbox gated = new SettlementInbox(bytes32("op9"), address(receiver), address(token), bytes32("c1"), 1000, 1000, address(3), block.timestamp + 1 days);
        token.mint(address(gated), 500);
        gated.notifyReceipt(500);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        gated.settle(500);
    }

    function testReceiptCapIsEnforced() public {
        SettlementInbox capped = new SettlementInbox(
            bytes32("capped"), address(receiver), address(token), bytes32("c1"), 0, 1_000, address(3), block.timestamp + 1 days
        );
        token.mint(address(capped), 1_000);
        capped.notifyReceipt(1_000);
        token.mint(address(capped), 1);
        vm.expectRevert(SettlementInbox.CapExceeded.selector);
        capped.notifyReceipt(1);
        assertEq(capped.received(), 1_000);
    }
}
