// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {RecoveryReserve} from "../../src/monad/house/RecoveryReserve.sol";
import {MockERC20} from "../MockERC20.sol";

contract LossAccountingTest is Test {
    MockERC20 token;
    HouseVault vault;
    RecoveryReserve reserve;
    bytes32 constant CREDIT = keccak256("loss");
    address constant NEW_LP = address(0xB);
    uint256 public debt = 420;

    function previewVaultAccrual(bytes32) external pure returns (uint256) { return 0; }
    function creditDebt(bytes32) external view returns (uint256) { return debt; }
    function creditFacility(bytes32) external pure returns (uint8) { return 10; }

    function setUp() public {
        token = new MockERC20();
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault",
            abi.encode(address(token), address(this), address(this), address(0), address(0))));
        reserve = vault.recoveryReserve();
        token.mint(address(this), 5000);
        token.approve(address(vault), type(uint256).max);
        token.approve(address(reserve), type(uint256).max);
        vault.deposit(address(this), 1000);
        vault.registerCredit(CREDIT);
        vault.reserve(CREDIT, 400);
        vault.fundDraw(CREDIT, address(0xA), 400);
        vault.recordAccruedReceivable(CREDIT, 20);
        vault.setProtocolFee(address(0xFEE), 1000);
    }

    function _repay(uint256 principal, uint256 receivable) internal {
        token.mint(address(vault), principal + receivable);
        vault.receiveRepay(CREDIT, principal + receivable, principal, receivable, 0);
        debt -= principal + receivable;
    }

    function testWaterfallAndLateRecoveriesBelongToLossCohort() public {
        reserve.fundFirstLoss(CREDIT, 0, 50);
        reserve.fundFirstLoss(CREDIT, 1, 60);
        reserve.fundReserves(70);
        assertEq(vault.totalAssets(), 1018);
        (uint256 queued,) = vault.requestWithdrawQueued(200, address(this));
        vault.writeOff(CREDIT, 400, 20);
        assertEq(vault.totalAssets(), 780);
        assertEq(vault.drawnPrincipal(), 0);
        assertEq(vault.contingentPrincipal(CREDIT), 400);
        assertEq(reserve.spent(CREDIT, 0, address(this)), 50);
        assertEq(reserve.spent(CREDIT, 1, address(this)), 60);
        assertEq(reserve.reservesSpent(CREDIT), 70);
        assertEq(vault.claimWithdrawal(queued), 156);

        token.mint(NEW_LP, 780);
        vm.startPrank(NEW_LP);
        token.approve(address(vault), 780);
        vault.deposit(NEW_LP, 780);
        vm.stopPrank();
        uint256 nav = vault.totalAssets();
        _repay(100, 0);
        assertEq(vault.totalAssets(), nav);
        assertEq(vault.claimLateRecovery(CREDIT), 100);
        vm.prank(NEW_LP);
        vm.expectRevert(HouseVault.InvalidAmount.selector);
        vault.claimLateRecovery(CREDIT);
        vm.expectRevert(RecoveryReserve.Invalid.selector);
        reserve.refund(CREDIT, 0);

        _repay(300, 20);
        assertEq(token.balanceOf(address(0xFEE)), 2);
        assertEq(vault.claimLateRecovery(CREDIT), 138);
        assertEq(reserve.reserves(), 70);
        assertEq(reserve.funded(CREDIT, 1, address(this)), 60);
        assertEq(reserve.funded(CREDIT, 0, address(this)), 50);
        assertEq(reserve.refund(CREDIT, 0), 50);
        assertEq(reserve.refund(CREDIT, 1), 60);
        assertEq(vault.totalAssets(), nav);
        assertEq(vault.lateRecoveryCash(), 0);
        vm.expectRevert(HouseVault.AccountingMismatch.selector);
        vault.writeOff(CREDIT, 0, 0);
    }

    function testImpairmentFreezesConversionsAndIsRemovedExactlyOnce() public {
        vault.setCreditImpairment(CREDIT, 200);
        assertEq(vault.totalAssets(), 818);
        vm.expectRevert(HouseVault.Closed.selector);
        vault.deposit(address(this), 100);
        vm.expectRevert(HouseVault.Closed.selector);
        vault.requestWithdraw(100);
        vault.writeOff(CREDIT, 400, 20);
        assertEq(vault.impairment(), 0);
        assertEq(vault.unresolvedCreditImpairment(), 0);
        assertEq(vault.totalAssets(), 600);
        _repay(100, 0);
        assertEq(vault.claimLateRecovery(CREDIT), 100);
        assertEq(vault.totalAssets(), 600);
    }

    function testPostWriteOffInterestRemainsContingent() public {
        vault.writeOff(CREDIT, 400, 20);
        vault.recordAccruedReceivable(CREDIT, 10);
        assertEq(vault.contingentReceivables(CREDIT), 30);
        assertEq(vault.totalAssets(), 600);
        _repay(400, 20);
        assertEq(vault.claimLateRecovery(CREDIT), 418);
        assertEq(vault.totalAssets(), 600);
    }
}
