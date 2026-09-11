// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract CollateralLockTest is Test {
    CollateralVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        token.mint(address(2), 200);
        vault = new CollateralVault(address(token), 1, address(this));
    }

    function testLock() public {
        vm.startPrank(address(2));
        token.approve(address(vault), 100);
        vault.lock(bytes32("l1"), bytes32("c1"), address(2), 100, address(3));
        vm.stopPrank();
        (bytes32 cid, address owner, uint256 amt,,,) = vault.locks(bytes32("l1"));
        assertEq(cid, bytes32("c1"));
        assertEq(owner, address(2));
        assertEq(amt, 100);
    }

    function testDoubleLockReverts() public {
        vm.startPrank(address(2));
        token.approve(address(vault), 100);
        vault.lock(bytes32("l2"), bytes32("c1"), address(2), 100, address(3));
        vm.stopPrank();
        vm.expectRevert(CollateralVault.Exists.selector);
        vault.lock(bytes32("l2"), bytes32("c1"), address(2), 100, address(3));
    }
}
