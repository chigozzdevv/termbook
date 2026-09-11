// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract CollateralReturnTest is Test {
    CollateralVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        token.mint(address(2), 50);
        vault = new CollateralVault(address(token), 1, address(this));
    }

    function testNonCoreCannotRelease() public {
        vm.startPrank(address(2));
        token.approve(address(vault), 50);
        vault.lock(bytes32("l1"), bytes32("c1"), address(2), 50, address(3));
        vm.stopPrank();
        vm.prank(address(9));
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vault.release(bytes32("l1"), address(3), 50, 1);
    }
}
