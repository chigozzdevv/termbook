// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InboxFactory} from "../../src/routing/InboxFactory.sol";
import {SettlementInbox} from "../../src/routing/SettlementInbox.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockSettlementReceiver} from "../MockSettlementReceiver.sol";

contract RouteReplayTest is Test {
    function testSeparateInboxes() public {
        InboxFactory f = new InboxFactory(address(this));
        MockERC20 token = new MockERC20();
        MockSettlementReceiver receiver = new MockSettlementReceiver();
        address a = f.create(bytes32("a"), address(receiver), address(token), bytes32("ca"), 0, 1_000, address(3), block.timestamp + 1 days);
        address b = f.create(bytes32("b"), address(receiver), address(token), bytes32("cb"), 0, 1_000, address(3), block.timestamp + 1 days);
        assertTrue(a != b);
        assertEq(SettlementInbox(a).operationId(), bytes32("a"));
    }

    function testGovernanceDelegatesRegistration() public {
        InboxFactory f = new InboxFactory(address(this));
        address registrar = address(0xBEEF);
        f.setRegistrar(registrar);
        MockERC20 token = new MockERC20();
        MockSettlementReceiver receiver = new MockSettlementReceiver();
        vm.prank(registrar);
        address inbox = f.create(
            bytes32("delegated"),
            address(receiver),
            address(token),
            bytes32("credit"),
            0,
            1_000,
            address(3),
            block.timestamp + 1 days
        );
        assertEq(SettlementInbox(inbox).maxReceived(), 1_000);
    }

    function testOnlyGovernanceChangesRegistrar() public {
        InboxFactory f = new InboxFactory(address(this));
        vm.prank(address(0xBEEF));
        vm.expectRevert(InboxFactory.Unauthorized.selector);
        f.setRegistrar(address(0xCAFE));
    }
}
