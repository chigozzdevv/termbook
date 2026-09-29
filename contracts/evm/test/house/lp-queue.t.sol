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
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(token), address(this), address(this), address(0), address(0))));
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

    function testQueuedSharesRemainExposedToLossUntilClaim() public {
        (uint256 id,) = vault.requestWithdrawQueued(500, address(2));
        vault.fundDraw(bytes32(uint256(1)), address(0xB), 900);
        token.mint(address(vault), 700);
        vault.receiveRepay(bytes32(uint256(1)), 700);
        vault.writeOff(bytes32(uint256(1)), 200, 0);
        assertEq(vault.queuedWithdrawalAssets(), 400);
        assertEq(vault.claimWithdrawal(id), 400);
        assertEq(vault.totalShares(), 500);
        assertEq(vault.sharePrice(), 0.8e18);
    }

    function testClaimsFollowQueueAndCancellationRemovesHead() public {
        (uint256 first,) = vault.requestWithdrawQueued(200, address(2));
        (uint256 second,) = vault.requestWithdrawQueued(200, address(3));
        vault.release(bytes32(uint256(1)), 900);
        vm.expectRevert(HouseVault.Insufficient.selector);
        vault.claimWithdrawal(second);
        vault.cancelWithdrawal(first);
        assertEq(vault.withdrawalHead(), second);
        vault.claimWithdrawal(second);
        assertEq(vault.withdrawalHead(), 0);
        assertEq(vault.withdrawalTail(), 0);
    }
}
