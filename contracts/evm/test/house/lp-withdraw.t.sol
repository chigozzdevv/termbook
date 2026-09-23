// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract LpWithdrawTest is Test {
    HouseVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        token.mint(address(this), 2000);
        vault = new HouseVault(address(token), address(this), address(this), address(0), address(0));
        token.approve(address(vault), type(uint256).max);
        vault.deposit(address(this), 2000);
    }

    function testOverWithdrawReverts() public {
        vm.expectRevert(HouseVault.Insufficient.selector);
        vault.requestWithdraw(1_000_000 ether);
    }

    function testImpairmentLowersPrice() public {
        uint256 before = vault.sharePrice();
        vault.recognizeImpairment(500);
        assertLt(vault.sharePrice(), before);
    }
}
