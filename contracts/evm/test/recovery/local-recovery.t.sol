// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {AccountFactory} from "../../src/monad/credit/AccountFactory.sol";
import {SettlementInbox} from "../../src/monad/routing/SettlementInbox.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {Types} from "../../src/shared/Types.sol";
import {MockHealthSource} from "../MockHealthSource.sol";

contract LocalRecoveryTest is Test {
    MockERC20 token;
    TermbookCore core;
    RiskEngine risk;
    HouseVault houseVault;
    InboxFactory inboxFactory;
    CollateralVault collateralVault;
    AccountFactory accounts;
    MockHealthSource healthSource;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;
    address house;
    address borrower;

    function setUp() public {
        token = new MockERC20();
        core = new TermbookCore(address(this), address(this), address(0));
        risk = new RiskEngine(address(core));
        healthSource = new MockHealthSource();
        inboxFactory = new InboxFactory(address(this));
        houseVault = new HouseVault(address(token), address(core), address(this), address(inboxFactory), address(0));
        collateralVault = new CollateralVault(address(token), block.chainid, address(core));
        core.setLocalCollateralVault(address(collateralVault), address(collateralVault).codehash);
        accounts = new AccountFactory();
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        core.setRisk(address(risk));
        core.setHealthSource(address(healthSource));
        core.setRecoveryKeeper(address(this), true);
        token.mint(address(this), 2_000);
        token.approve(address(houseVault), 1_000);
        houseVault.deposit(address(this), 1_000);
        token.mint(borrower, 1_000);
    }

    function _prepare(bytes32 creditId) internal returns (bytes32 lockId) {
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 intentId = keccak256("intent");
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(houseVault),
            500,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            0,
            1,
            expiry,
            termsHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.prank(borrower);
        core.accept(
            creditId,
            intentId,
            borrower,
            house,
            address(houseVault),
            500,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            termsHash,
            1,
            expiry,
            abi.encodePacked(r, s, v)
        );
        vm.startPrank(borrower);
        token.approve(address(collateralVault), 1_000);
        core.setCollateral(creditId, address(collateralVault), borrower);
        lockId = keccak256("lock");
        collateralVault.lock(lockId, creditId, borrower, 1_000, borrower);
        vm.stopPrank();
        vm.prank(borrower);
        core.bindCollateral(creditId, lockId);
        address account = accounts.create(creditId, borrower, address(core));
        vm.prank(borrower);
        core.bindAccount(creditId, account);
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        _recordHealth(creditId, Types.HealthSnapshot(0, 0, 1_000, 0, 10_000, 0, 0, 1_000, 0));
    }

    function _recordHealth(bytes32 creditId, Types.HealthSnapshot memory snapshot) internal {
        healthSource.setSnapshot(creditId, snapshot);
        core.recordHealth(creditId);
    }

    function _draw(bytes32 creditId) internal {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(500), uint256(500), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 500, 500, 1, deadline, abi.encodePacked(r, s, v));
    }

    function _liquidate(bytes32 creditId) internal {
        _recordHealth(creditId, Types.HealthSnapshot(500, 0, 0, 0, 10_000, 0, 0, 0, 0));
        core.startLiquidation(creditId);
    }

    function testKeeperSeizesCollateralAndRepaysOriginatingHouse() public {
        bytes32 creditId = keccak256("credit");
        bytes32 lockId = _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);
        core.recoverCollateral(creditId, 500);

        assertEq(core.creditDebt(creditId), 0);
        assertEq(houseVault.drawnPrincipal(), 0);
        assertEq(token.balanceOf(address(houseVault)), 1_000);
        (,, uint256 remaining,,,) = collateralVault.locks(lockId);
        assertEq(remaining, 500);
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        core.finishLiquidation(creditId);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.RecoveryPending));
    }

    function testKeeperRepaysOnlyVerifiedFreeAccountCash() public {
        bytes32 creditId = keccak256("account-cash-recovery");
        _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);
        address account = core.creditAccount(creditId);
        healthSource.setSnapshot(creditId, Types.HealthSnapshot(500, 200, 0, 0, 0, 0, 0, 200, 4_000));
        vm.expectRevert(TermbookCore.Unauthorized.selector);
        vm.prank(address(0xD00D));
        core.recoverAccountCash(creditId, 200);
        vm.expectRevert(TermbookCore.OverLimit.selector);
        core.recoverAccountCash(creditId, 201);
        core.recoverAccountCash(creditId, 200);
        assertEq(token.balanceOf(account), 300);
        assertEq(core.creditDebt(creditId), 300);
        assertEq(houseVault.drawnPrincipal(), 300);
    }

    function testUnregisteredKeeperCannotSeizeCollateral() public {
        bytes32 creditId = keccak256("credit-unauthorized");
        _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);
        vm.prank(address(0xD00D));
        vm.expectRevert(TermbookCore.Unauthorized.selector);
        core.recoverCollateral(creditId, 500);
    }

    function testCureRequiresMaintenanceHealth() public {
        bytes32 creditId = keccak256("cure-maintenance");
        _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);

        token.mint(borrower, 100);
        vm.startPrank(borrower);
        token.approve(address(core), 100);
        core.repay(creditId, 100);
        vm.stopPrank();

        _recordHealth(creditId, Types.HealthSnapshot(400, 0, 500, 0, 10_000, 0, 0, 500, 12_500));
        vm.expectRevert(TermbookCore.BadHealth.selector);
        core.cure(creditId);
    }

    function testFinalizedRecoveryCannotCure() public {
        bytes32 creditId = keccak256("finalized-recovery-cure");
        _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);
        core.recoverCollateral(creditId, 100);
        vm.prank(address(houseVault));
        core.finalizeRecovery(creditId);
        _recordHealth(creditId, Types.HealthSnapshot(400, 0, 1_000, 0, 10_000, 0, 0, 1_000, 25_000));
        vm.expectRevert(TermbookCore.BadState.selector);
        core.cure(creditId);
    }

    function testSettlementRecoveryTransitionsAndFinalizes() public {
        bytes32 creditId = keccak256("credit-settlement-recovery");
        _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);

        SettlementInbox inbox = SettlementInbox(inboxFactory.create(
            keccak256("recovery-operation"),
            address(houseVault),
            address(token),
            creditId,
            500,
            500,
            borrower,
            block.timestamp + 1 days
        ));
        houseVault.setSettlementInbox(address(inbox), true);
        token.mint(address(inbox), 500);
        inbox.notifyAll();
        inbox.settle(500);

        assertEq(core.creditDebt(creditId), 0);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.RecoveryPending));
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        core.finishLiquidation(creditId);
    }

    function testDirectRepaymentDuringLiquidationTransitionsAndFinalizes() public {
        bytes32 creditId = keccak256("credit-direct-recovery");
        _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);

        token.mint(borrower, 500);
        vm.startPrank(borrower);
        token.approve(address(core), 500);
        core.repay(creditId, 500);
        vm.stopPrank();

        assertEq(core.creditDebt(creditId), 0);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.RecoveryPending));
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        core.finishLiquidation(creditId);
    }

    function testLateSettlementAfterLiquidationRecordsRecovery() public {
        bytes32 creditId = keccak256("credit-late-recovery");
        _prepare(creditId);
        _draw(creditId);
        _liquidate(creditId);
        core.recoverCollateral(creditId, 100);

        vm.prank(address(houseVault));
        core.finalizeRecovery(creditId);
        core.finishLiquidation(creditId);

        SettlementInbox inbox = SettlementInbox(inboxFactory.create(
            keccak256("late-recovery-operation"),
            address(houseVault),
            address(token),
            creditId,
            100,
            100,
            borrower,
            block.timestamp + 1 days
        ));
        houseVault.setSettlementInbox(address(inbox), true);
        token.mint(address(inbox), 100);
        inbox.notifyAll();
        inbox.settle(100);

        assertEq(core.creditDebt(creditId), 300);
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        assertEq(credit.recovery, 200);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.Liquidated));
    }
}
