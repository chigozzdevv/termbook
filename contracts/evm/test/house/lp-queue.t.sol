// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract LpQueueTest is Test {
    HouseVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        vault = new HouseVault(address(token), address(this), address(this), address(0), address(0));
        token.mint(address(this), 1_000);
        token.approve(address(vault), 1_000);
        vault.deposit(address(this), 1_000);
        vault.reserve(bytes32(uint256(1)), 900);
    }

    function testQueuedClaimWaitsForFreeCash() public {
        (uint256 id, uint256 amount) = vault.requestWithdrawQueued(500, address(2));
        assertEq(id, 1);
        assertEq(amount, 500);
        vm.expectRevert(HouseVault.Insufficient.selector);
        vault.claimWithdrawal(id);
        vault.release(bytes32(uint256(1)), 900);
        uint256 beforeBalance = token.balanceOf(address(2));
        vault.claimWithdrawal(id);
        assertEq(token.balanceOf(address(2)) - beforeBalance, 500);
    }

    function testCancelledQueueRestoresShares() public {
        uint256 beforeShares = vault.shares(address(this));
        (uint256 id,) = vault.requestWithdrawQueued(500, address(2));
        vault.cancelWithdrawal(id);
        assertEq(vault.shares(address(this)), beforeShares);
    }
}
