// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RealFlowTest} from "./integration/real-flow.t.sol";
import {Types} from "../src/shared/Types.sol";
import {TermbookCore} from "../src/monad/credit/TermbookCore.sol";
import {HouseVault} from "../src/monad/house/HouseVault.sol";
import {RiskEngine} from "../src/monad/risk/RiskEngine.sol";

contract AuditReviewTest is RealFlowTest {
    function drawAudit(bytes32 id, uint256 amount, uint256 nonce) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), id, amount, amount, nonce, deadline, core.creditRevision(id)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(id, amount, amount, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function testAuditQueueCannotBlockRevolvingRepayment() public {
        bytes32 id = keccak256("audit-queue");
        _prepareTerms(id);
        drawAudit(id, 400, 1);
        houseVault.requestWithdrawQueued(9_700, address(this));
        vm.startPrank(borrower);
        token.approve(address(core), 110);
        core.repay(id, 110);
        vm.stopPrank();
        assertEq(core.creditDebt(id), 300);
        assertEq(houseVault.creditCommitted(id), 200);
    }

    function testPartialRecoveryRetainsCommitmentAndCures() public {
        bytes32 id = keccak256("audit-recommit");
        _prepareTerms(id);
        drawAudit(id, 400, 1);
        _recordHealth(id, Types.HealthSnapshot(410, 0, 0, 0, 0, 0, 0, 0, 0));
        core.startLiquidation(id);
        assertEq(houseVault.creditCommitted(id), 100);
        vm.startPrank(borrower);
        token.approve(address(core), 410);
        core.repay(id, 410);
        vm.stopPrank();
        assertEq(houseVault.creditCommitted(id), 500);
        assertEq(uint256(core.creditFacility(id)), uint256(Types.Facility.RecoveryPending));
        vm.expectRevert(TermbookCore.Unauthorized.selector);
        core.finalizeRecovery(id);
        assertEq(core.creditDebt(id), 0);
        core.cure(id);
        assertEq(uint256(core.creditFacility(id)), uint256(Types.Facility.Ready));
        assertEq(houseVault.creditCommitted(id), 500);
    }

    function testFullRecoveryReleasesCommitmentAndFinalizesThroughHouse() public {
        bytes32 id = keccak256("full-recovery");
        _prepareTerms(id);
        drawAudit(id, 400, 1);
        _recordHealth(id, Types.HealthSnapshot(410, 0, 0, 0, 0, 0, 0, 0, 0));
        core.setRecoveryKeeper(address(this), true);
        core.startLiquidation(id);
        core.commitFullRecovery(id);
        assertEq(houseVault.creditCommitted(id), 0);
        vm.startPrank(borrower);
        token.approve(address(core), 410);
        core.repay(id, 410);
        vm.stopPrank();
        assertEq(houseVault.creditCommitted(id), 0);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.cure(id);
        houseVault.finalizeRecovery(id);
        assertEq(uint256(core.creditFacility(id)), uint256(Types.Facility.Liquidated));
        assertTrue(core.creditDetails(id).recoveryFinalized);
        assertEq(houseVault.activeCreditCount(), 0);
        vm.expectRevert(TermbookCore.BadState.selector);
        houseVault.finalizeRecovery(id);
    }

    function testMaturityEndsSuspendedCommitment() public {
        bytes32 id = keccak256("partial-maturity");
        _prepareTerms(id);
        drawAudit(id, 400, 1);
        _recordHealth(id, Types.HealthSnapshot(410, 0, 0, 0, 0, 0, 0, 0, 0));
        core.startLiquidation(id);
        assertEq(houseVault.creditCommitted(id), 100);
        vm.warp(core.creditDetails(id).maturity);
        core.markMatured(id);
        assertEq(houseVault.creditCommitted(id), 0);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.cure(id);
    }

    function testAuditDrawRefreshesHealthAfterAccrual() public {
        bytes32 id = keccak256("audit-accrual");
        _prepareTerms(id);
        drawAudit(id, 400, 1);
        vm.warp(block.timestamp + (365 days / 40) - 1);
        _recordHealth(id, Types.HealthSnapshot(410, 400, 600, 0, 10_000, 0, 0, 1000, 0));
        uint256 snapshotAt = core.healthSnapshotAt(id);
        vm.warp(block.timestamp + 2);
        assertLt(block.timestamp - snapshotAt, core.healthMaxAge());
        assertGt(core.creditDebt(id), 410);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), id, uint256(1), uint256(1), uint256(2), deadline, core.creditRevision(id)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(id, 1, 1, 2, deadline, abi.encodePacked(r, s, v));
        assertEq(core.creditDetails(id).principal, 401);
    }

    function testAuditClosingFreezesBeforeRepayment() public {
        bytes32 id = keccak256("audit-close");
        _prepare(id);
        drawAudit(id, 400, 1);
        vm.prank(borrower);
        core.startClosing(id);
        assertEq(uint256(core.creditFacility(id)), uint256(Types.Facility.Closing));
        assertEq(core.creditDebt(id), 400);
        assertEq(houseVault.creditCommitted(id), 0);
        bytes32 lockId = core.creditDetails(id).lockId;
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.Unauthorized.selector);
        core.authorizeReturn(id, lockId, 1);
    }

    function testAuditWithdrawalRejectsChangedMarketValue() public {
        bytes32 id = keccak256("audit-stale-market");
        _prepare(id);
        drawAudit(id, 400, 1);
        _recordHealth(id, Types.HealthSnapshot(400, 400, 600, 0, 10_000, 0, 0, 1000, 0));
        healthSource.setSnapshot(id, Types.HealthSnapshot(400, 400, 0, 0, 10_000, 0, 0, 400, 10_000));
        vm.expectRevert(RiskEngine.NoWithdraw.selector);
        vm.prank(borrower);
        core.withdraw(id, address(token), borrower, 300);
        assertEq(token.balanceOf(core.creditAccount(id)), 400);
    }

    function testAuditRecoveryPaysPrincipalBeforeProtocolFees() public {
        bytes32 id = keccak256("audit-fees");
        _prepareTerms(id);
        drawAudit(id, 400, 1);
        vm.prank(address(core));
        houseVault.setProtocolFee(address(0xFEE), 1000);
        core.setRecoveryKeeper(address(this), true);
        _recordHealth(id, Types.HealthSnapshot(410, 0, 0, 0, 0, 0, 0, 0, 0));
        core.startLiquidation(id);
        core.recoverCollateral(id, 10);
        assertEq(token.balanceOf(address(0xFEE)), 0);
        assertEq(core.creditDetails(id).principal, 390);
    }

    function testAuditQueueCancellationPreservesOtherLpValue() public {
        address other = address(0xA11CE);
        token.mint(other, 10_000);
        vm.startPrank(other);
        token.approve(address(houseVault), 10_000);
        houseVault.deposit(other, 10_000);
        vm.stopPrank();
        (uint256 withdrawalId,) = houseVault.requestWithdrawQueued(10_000, address(this));
        vm.prank(address(core));
        houseVault.recordAccruedReceivable(keccak256("interest"), 10_000);
        assertEq(houseVault.sharePrice(), 1.5e18);
        uint256 otherValue = houseVault.shares(other) * houseVault.sharePrice() / 1e18;
        houseVault.cancelWithdrawal(withdrawalId);
        assertEq(houseVault.sharePrice(), 1.5e18);
        assertEq(houseVault.shares(other) * houseVault.sharePrice() / 1e18, otherValue);
        assertEq(houseVault.shares(address(this)) * houseVault.sharePrice() / 1e18, 15_000);
    }

    function testAuditLpDepositIncludesPendingLoanAccrual() public {
        bytes32 id = keccak256("audit-nav");
        _prepareTerms(id);
        drawAudit(id, 400, 1);
        vm.warp(block.timestamp + 365 days);
        assertEq(houseVault.pendingAccrual(), 50);
        assertEq(houseVault.totalAssets(), 10_060);
        address other = address(0xA11CE);
        token.mint(other, 10_060);
        vm.startPrank(other);
        token.approve(address(houseVault), 10_060);
        assertEq(houseVault.deposit(other, 10_060), 10_000);
        vm.stopPrank();
        uint256 price = houseVault.sharePrice();
        core.accrue(id);
        assertEq(houseVault.pendingAccrual(), 0);
        assertEq(houseVault.sharePrice(), price);
    }
}
