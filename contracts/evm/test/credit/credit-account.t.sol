// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {MockERC20} from "../MockERC20.sol";

contract CreditAccountTest is Test {
    function testReleaseRequiresClearedApprovalsAndPermanentlyTransfersControl() public {
        address borrower = address(1);
        CreditAccount account = new CreditAccount(bytes32("credit"), borrower, address(this));
        MockERC20 token = new MockERC20();
        token.mint(address(account), 10);
        vm.prank(borrower);
        vm.expectRevert(CreditAccount.Unauthorized.selector);
        account.transferToken(address(token), borrower, 10);
        account.approveSpend(address(token), address(2), 5);
        assertEq(account.activeAllowances(), 1);
        vm.expectRevert(CreditAccount.Unauthorized.selector);
        account.releaseControl();
        account.approveSpend(address(token), address(2), 0);
        account.releaseControl();
        assertTrue(account.released());
        vm.expectRevert(CreditAccount.Unauthorized.selector);
        account.transferToken(address(token), address(this), 10);
        vm.prank(borrower);
        account.transferToken(address(token), borrower, 10);
        assertEq(token.balanceOf(borrower), 10);
        vm.expectRevert(CreditAccount.Unauthorized.selector);
        account.releaseControl();
    }
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
