// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract LpDepositTest is Test {
    HouseVault vault;
    MockERC20 token;

    function setUp() public {
        token = new MockERC20();
        token.mint(address(this), 100);
        vault = new HouseVault(address(token), address(this), address(this));
        token.approve(address(vault), type(uint256).max);
    }

    function testZeroMintRejected() public {
        vm.expectRevert(HouseVault.InvalidAmount.selector);
        vault.deposit(address(7), 0);
    }

    function testPausedBlocksDeposit() public {
        vault.setDepositsOpen(false);
        vm.expectRevert(HouseVault.Closed.selector);
        vault.deposit(address(7), 100);
    }
}
