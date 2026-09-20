// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract HouseAccountingTest is Test {
    HouseVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        token.mint(address(this), 3e18);
        vault = new HouseVault(address(token), address(this), address(this));
        token.approve(address(vault), type(uint256).max);
    }

    function testDepositMints() public {
        uint256 shares = vault.deposit(address(7), 1e18);
        assertGt(shares, 0);
        assertEq(vault.freeCash(), 1e18);
    }

    function testSharePriceNearOne() public {
        vault.deposit(address(7), 1e18);
        uint256 price = vault.sharePrice();
        assertGe(price, 0.99e18);
        assertLe(price, 1e18);
    }

    function testWithdraw() public {
        vault.deposit(address(this), 1e18);
        uint256 price = vault.sharePrice();
        uint256 shares = (0.1e18 * 1e18) / price;
        uint256 got = vault.requestWithdraw(shares);
        assertGt(got, 0);
    }

    function testDonationResistant() public {
        vault.deposit(address(7), 1e18);
        uint256 price = vault.sharePrice();
        assertGt(price, 0);
    }

    function testQueuedWithdrawalsAreNotReserveable() public {
        vault.deposit(address(this), 1e18);
        vault.requestWithdrawQueued(0.5e18, address(8));
        assertEq(vault.availableCash(), 0.5e18);
        vm.expectRevert(HouseVault.Insufficient.selector);
        vault.reserve(bytes32(uint256(2)), 0.500000000000000001 ether);
    }

    function testVotingPowerMaturesAndLeavesWithShares() public {
        vault.deposit(address(this), 1e18);
        assertEq(vault.votingPower(address(this)), 0);
        vm.warp(block.timestamp + vault.GOVERNANCE_HOLD());
        assertEq(vault.votingPower(address(this)), vault.shares(address(this)));
        uint256 shares = vault.shares(address(this)) / 2;
        vault.requestWithdrawQueued(shares, address(8));
        assertEq(vault.votingPower(address(this)), vault.shares(address(this)));
    }

    function testProtocolFeeIsTakenOnlyFromHouseReceivables() public {
        bytes32 creditId = bytes32(uint256(3));
        vault.deposit(address(this), 1e18);
        vault.reserve(creditId, 0.5e18);
        vault.fundDraw(creditId, address(2), 0.5e18);
        vault.recordAccruedReceivable(creditId, 0.1e18);
        vault.setProtocolFee(address(9), 1_000);
        token.mint(address(vault), 0.6e18);

        vault.receiveRepay(creditId, 0.6e18, 0.5e18, 0.1e18, 0);

        assertEq(token.balanceOf(address(9)), 0.01e18);
        assertEq(vault.protocolFeesPaid(), 0.01e18);
        assertEq(vault.freeCash(), 1.09e18);
        assertEq(vault.drawnPrincipal(), 0);
    }
}
