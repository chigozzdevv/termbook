// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";

contract CreditAccountTest is Test {
    function testOnlyCoreExecutes() public {
        CreditAccount acc = new CreditAccount(bytes32("c"), address(1), address(this));
        vm.expectRevert(CreditAccount.Unauthorized.selector);
        vm.prank(address(2));
        acc.execute(address(3), "");
    }

    function testRejectSelfTarget() public {
        CreditAccount acc = new CreditAccount(bytes32("c"), address(1), address(this));
        vm.expectRevert(CreditAccount.BadTarget.selector);
        acc.execute(address(acc), "");
    }
}
