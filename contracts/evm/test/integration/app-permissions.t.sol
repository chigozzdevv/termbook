// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";

contract PermissionTarget {
    function execute() external {}
}

contract BoundPermissionTarget {
    function execute(address, uint256) external {}
}

contract AppPermissionsTest is Test {
    function testFreezeBlocksUse() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        r.approve(bytes32("v1"), bytes32("code"));
        assertFalse(r.isActive(bytes32("v1")));
        r.freeze(bytes32("v1"));
        (,, bool frozen) = r.versions(bytes32("v1"));
        assertTrue(frozen);
    }

    function testCodeIdentityMustRemainTheReviewedDeployment() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        PermissionTarget target = new PermissionTarget();
        r.approve(bytes32("v1"), bytes32("code"));
        r.registerCall(
            bytes32("v1"), address(target), PermissionTarget.execute.selector, 4, type(uint8).max, type(uint8).max, 0
        );
        r.activate(bytes32("v1"));
        assertTrue(r.isActive(bytes32("v1")));
        assertTrue(r.isCallAllowed(bytes32("v1"), address(target), PermissionTarget.execute.selector));
        vm.etch(address(target), hex"6000");
        assertFalse(r.isCallAllowed(bytes32("v1"), address(target), PermissionTarget.execute.selector));
        r.freeze(bytes32("v1"));
        assertFalse(r.isActive(bytes32("v1")));
    }

    function testCallParametersAreBoundToTheCreditAccount() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        BoundPermissionTarget target = new BoundPermissionTarget();
        address account = address(0xA11CE);
        r.approve(bytes32("v1"), bytes32("code"));
        r.registerCall(bytes32("v1"), address(target), BoundPermissionTarget.execute.selector, 68, 0, 1, 100);
        r.activate(bytes32("v1"));
        bytes memory valid = abi.encodeCall(BoundPermissionTarget.execute, (account, 50));
        assertTrue(r.validateCall(bytes32("v1"), address(target), valid, account, 50));
        bytes memory wrongRecipient = abi.encodeCall(BoundPermissionTarget.execute, (address(0xB0B), 50));
        assertFalse(r.validateCall(bytes32("v1"), address(target), wrongRecipient, account, 50));
        bytes memory tooLarge = abi.encodeCall(BoundPermissionTarget.execute, (account, 101));
        assertFalse(r.validateCall(bytes32("v1"), address(target), tooLarge, account, 50));
    }

    function testActiveVersionCannotChangeCallPolicy() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        BoundPermissionTarget target = new BoundPermissionTarget();
        bytes32 id = bytes32("v1");
        r.approve(id, bytes32("code"));
        r.registerCall(id, address(target), BoundPermissionTarget.execute.selector, 68, 0, 1, 100);
        r.activate(id);
        vm.expectRevert(IntegrationRegistry.Invalid.selector);
        r.registerCall(id, address(target), BoundPermissionTarget.execute.selector, 68, 0, 1, 1_000);
    }
}
