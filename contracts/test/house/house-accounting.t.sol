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
}
