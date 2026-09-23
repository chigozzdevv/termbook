// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract CollateralProofTest is Test {
    CollateralVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        token.mint(address(2), 200);
        vault = new CollateralVault(address(token), 1, address(this));
    }

    function testReleaseConsumesOnce() public {
        vm.startPrank(address(2));
        token.approve(address(vault), 100);
        vault.lock(bytes32("l1"), bytes32("c1"), address(2), 100, address(3));
        vm.stopPrank();
        token.mint(address(3), 0);
        vault.release(bytes32("l1"), address(3), 100, 1);
        assertTrue(vault.consumed(bytes32("l1")));
    }

    function testReplayReleaseReverts() public {
        vm.startPrank(address(2));
        token.approve(address(vault), 100);
        vault.lock(bytes32("l2"), bytes32("c1"), address(2), 100, address(3));
        vm.stopPrank();
        vault.release(bytes32("l2"), address(3), 100, 7);
        vm.expectRevert();
        vault.release(bytes32("l2"), address(3), 100, 8);
    }
}
