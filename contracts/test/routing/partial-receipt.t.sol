// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementInbox} from "../../src/routing/SettlementInbox.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockSettlementReceiver} from "../MockSettlementReceiver.sol";

contract PartialReceiptTest is Test {
    SettlementInbox inbox;
    MockERC20 token;
    MockSettlementReceiver receiver;

    function setUp() public {
        token = new MockERC20();
        receiver = new MockSettlementReceiver();
        inbox = new SettlementInbox(bytes32("op3"), address(receiver), address(token), bytes32("c3"), 0, 900, address(3), block.timestamp + 1 days);
    }

    function testPartialApply() public {
        token.mint(address(inbox), 900);
        inbox.notifyReceipt(500);
        inbox.notifyReceipt(400);
        inbox.settle(900);
        assertEq(inbox.applied(), 900);
    }

    function testOverApplyReverts() public {
        token.mint(address(inbox), 100);
        inbox.notifyReceipt(100);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        inbox.settle(101);
    }
}
