// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntegrationRegistry} from "../../src/integration/IntegrationRegistry.sol";

contract PermissionTarget {
    function execute() external {}
}

contract AppPermissionsTest is Test {
    function testFreezeBlocksUse() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        r.approve(bytes32("v1"), bytes32("code"));
        r.freeze(bytes32("v1"));
        (,, bool frozen) = r.versions(bytes32("v1"));
        assertTrue(frozen);
    }

    function testCodeIdentityMustRemainTheReviewedDeployment() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        PermissionTarget target = new PermissionTarget();
        r.approve(bytes32("v1"), bytes32("code"));
        r.registerCall(bytes32("v1"), address(target), PermissionTarget.execute.selector);
        assertTrue(r.isCallAllowed(bytes32("v1"), address(target), PermissionTarget.execute.selector));
        vm.etch(address(target), hex"6000");
        assertFalse(r.isCallAllowed(bytes32("v1"), address(target), PermissionTarget.execute.selector));
    }
}
