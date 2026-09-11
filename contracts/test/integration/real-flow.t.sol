// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {AccountFactory} from "../../src/credit/AccountFactory.sol";
import {CreditAccount} from "../../src/credit/CreditAccount.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {RiskEngine} from "../../src/risk/RiskEngine.sol";
import {Types} from "../../src/shared/Types.sol";
import {SettlementInbox} from "../../src/routing/SettlementInbox.sol";

contract RealFlowTarget {
    uint256 public value;

    function setValue(uint256 value_) external {
        value = value_;
    }
}

contract RealFlowTest is Test {
    MockERC20 token;
    TermbookCore core;
    HouseVault houseVault;
    CollateralVault collateralVault;
    AccountFactory accountFactory;
    RiskEngine risk;
    RealFlowTarget target;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;
    address house;
    address borrower;

    function setUp() public {
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        token = new MockERC20();
        core = new TermbookCore(address(this), address(this), address(0));
        risk = new RiskEngine(address(core));
        core.setRisk(address(risk));
        houseVault = new HouseVault(address(token), address(core), address(this));
        collateralVault = new CollateralVault(address(token), block.chainid, address(core));
        accountFactory = new AccountFactory();
        target = new RealFlowTarget();
        token.mint(address(this), 10_000);
        token.approve(address(houseVault), 10_000);
        houseVault.deposit(address(this), 10_000);
        token.mint(borrower, 1_000);
        core.setApprovedCall(address(target), RealFlowTarget.setValue.selector, true);
    }

    function _accept(bytes32 creditId, bytes32 intentId, uint256 limit) internal {
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(intentId, borrower, house, address(houseVault), limit, maturity, false, bundleId, setupDeadline, 0, 0, 1, expiry, termsHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.prank(borrower);
        core.accept(creditId, intentId, borrower, house, address(houseVault), limit, maturity, false, bundleId, setupDeadline, 0, termsHash, 1, expiry, abi.encodePacked(r, s, v));
    }

    function _prepareTerms(bytes32 creditId) internal returns (bytes32 lockId, address account) {
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 2 * 365 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 intentId = keccak256("terms-intent");
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigestWithTerms(intentId, borrower, house, address(houseVault), 500, maturity, true, bundleId, setupDeadline, 0, 0, 7, expiry, termsHash, 1000, 10, 1000);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.prank(borrower);
        core.acceptWithTerms(creditId, intentId, borrower, house, address(houseVault), 500, maturity, true, bundleId, setupDeadline, 0, 0, termsHash, 7, expiry, 1000, 10, 1000, abi.encodePacked(r, s, v));
        vm.startPrank(borrower);
        token.approve(address(collateralVault), 500);
        core.setCollateral(creditId, address(collateralVault), borrower);
        lockId = keccak256("terms-lock");
        collateralVault.lock(lockId, creditId, borrower, 500, borrower);
        vm.stopPrank();
        vm.prank(borrower);
        core.bindCollateral(creditId, lockId);
        account = accountFactory.create(creditId, borrower, address(core));
        vm.prank(borrower);
        core.bindAccount(creditId, account);
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        core.recordHealth(creditId, Types.HealthSnapshot(0, 0, 0, 0, 0, 0, 0, 10_000, 0));
    }

    function _prepare(bytes32 creditId) internal returns (bytes32 lockId, address account) {
        _accept(creditId, keccak256("intent"), 500);
        vm.startPrank(borrower);
        token.approve(address(collateralVault), 500);
        core.setCollateral(creditId, address(collateralVault), borrower);
        lockId = keccak256("lock");
        collateralVault.lock(lockId, creditId, borrower, 500, borrower);
        vm.stopPrank();
        vm.prank(borrower);
        core.bindCollateral(creditId, lockId);
        account = accountFactory.create(creditId, borrower, address(core));
        vm.prank(borrower);
        core.bindAccount(creditId, account);
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        Types.HealthSnapshot memory snapshot = Types.HealthSnapshot(0, 0, 0, 0, 0, 0, 0, 10_000, 0);
        core.recordHealth(creditId, snapshot);
    }

    function testDrawRepayAndCloseMovesAssets() public {
        bytes32 creditId = keccak256("credit");
        (bytes32 lockId,) = _prepare(creditId);
        assertEq(token.balanceOf(core.creditAccount(creditId)), 0);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId, uint256(400), uint256(400), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 400, 400, 1, deadline, abi.encodePacked(r, s, v));
        assertEq(token.balanceOf(core.creditAccount(creditId)), 400);
        vm.startPrank(borrower);
        token.approve(address(core), 400);
        core.repay(creditId, 400);
        core.startClosing(creditId);
        core.authorizeReturn(creditId, lockId, 250);
        core.authorizeReturn(creditId, lockId, 250);
        vm.stopPrank();
        core.finishClose(creditId);
        assertEq(token.balanceOf(borrower), 600);
    }

    function testInterestFeesAndRepaymentAllocation() public {
        bytes32 creditId = keccak256("terms-credit");
        _prepareTerms(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId, uint256(400), uint256(400), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 400, 400, 1, deadline, abi.encodePacked(r, s, v));
        vm.warp(block.timestamp + 365 days);
        assertEq(core.creditDebt(creditId), 460);
        core.accrue(creditId);
        assertEq(houseVault.accruedReceivables(), 60);
        vm.startPrank(borrower);
        token.approve(address(core), 15);
        core.repay(creditId, 15);
        token.approve(address(core), 445);
        core.repay(creditId, 445);
        vm.stopPrank();
        assertEq(core.creditDebt(creditId), 0);
        assertEq(houseVault.creditDrawn(creditId), 0);
        assertEq(houseVault.drawnPrincipal(), 0);
        assertEq(houseVault.accruedReceivables(), 0);
    }

    function testCollateralWithdrawalMaintainsHealthSnapshot() public {
        bytes32 creditId = keccak256("collateral-withdraw-credit");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId, uint256(200), uint256(200), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 200, 200, 1, deadline, abi.encodePacked(r, s, v));
        core.recordHealth(creditId, Types.HealthSnapshot(200, 0, 1000, 0, 10_000, 10_000, 0, 1000, 50_000));
        vm.prank(borrower);
        core.withdrawCollateral(creditId, 250);
        Types.HealthSnapshot memory updated = risk.snapshot(creditId);
        assertEq(updated.sourceValue, 500);
        vm.expectRevert();
        vm.prank(borrower);
        core.withdrawCollateral(creditId, 200);
    }

    function testExecuteActionIsAtomic() public {
        bytes32 creditId = keccak256("action-credit");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes memory data = abi.encodeWithSelector(RealFlowTarget.setValue.selector, 42);
        bytes32 actionHash = keccak256(abi.encode(address(target), data));
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId, actionHash, uint256(200), uint256(200), uint256(2), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.executeAction(creditId, address(target), data, 200, 200, 2, deadline, abi.encodePacked(r, s, v));
        assertEq(target.value(), 42);
        assertEq(core.creditDebt(creditId), 200);
    }

    function testBondSettlementAndRevolvingCapacity() public {
        bytes32 creditId = keccak256("bond-credit");
        bytes32 intentId = keccak256("bond-intent");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(intentId, borrower, house, address(houseVault), 500, maturity, true, bundleId, setupDeadline, 0, 50, 9, expiry, termsHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        token.mint(borrower, 50);
        vm.startPrank(borrower);
        token.approve(address(houseVault), 50);
        core.acceptWithBond(creditId, intentId, borrower, house, address(houseVault), 500, maturity, true, bundleId, setupDeadline, 0, 50, termsHash, 9, expiry, abi.encodePacked(r, s, v));
        vm.stopPrank();
        assertEq(houseVault.bondLiabilities(), 50);
        (bytes32 lockId,) = _prepareAfterAccept(creditId);
        assertEq(lockId, keccak256("lock"));
        assertEq(houseVault.bondLiabilities(), 0);
        assertEq(houseVault.creditCommitted(creditId), 500);
        uint256 firstRevision = core.creditRevision(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 drawDigest = keccak256(abi.encode(core.domain(), creditId, uint256(400), uint256(400), uint256(1), deadline, firstRevision));
        (v, r, s) = vm.sign(borrowerKey, drawDigest);
        core.draw(creditId, 400, 400, 1, deadline, abi.encodePacked(r, s, v));
        vm.startPrank(borrower);
        token.approve(address(core), 400);
        core.repay(creditId, 400);
        vm.stopPrank();
        assertEq(houseVault.creditCommitted(creditId), 500);
    }

    function _prepareAfterAccept(bytes32 creditId) internal returns (bytes32 lockId, address account) {
        vm.startPrank(borrower);
        token.approve(address(collateralVault), 500);
        core.setCollateral(creditId, address(collateralVault), borrower);
        lockId = keccak256("lock");
        collateralVault.lock(lockId, creditId, borrower, 500, borrower);
        vm.stopPrank();
        vm.prank(borrower);
        core.bindCollateral(creditId, lockId);
        account = accountFactory.create(creditId, borrower, address(core));
        vm.prank(borrower);
        core.bindAccount(creditId, account);
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        core.recordHealth(creditId, Types.HealthSnapshot(0, 0, 0, 0, 0, 0, 0, 10_000, 0));
    }

    function testInboxSettlementUpdatesDebtAtomically() public {
        bytes32 creditId = keccak256("inbox-credit");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId, uint256(300), uint256(300), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 300, 300, 1, deadline, abi.encodePacked(r, s, v));
        SettlementInbox inbox = new SettlementInbox(keccak256("repay-operation"), address(houseVault), address(token), creditId, 300, borrower, deadline);
        houseVault.setSettlementInbox(address(inbox), true);
        token.mint(address(inbox), 300);
        inbox.notifyAll();
        inbox.settle(300);
        assertEq(core.creditDebt(creditId), 0);
        assertEq(inbox.available(), 0);
        assertEq(houseVault.pendingSettlement(), 0);
    }

    function testLpInboxMintsSharesAtomically() public {
        SettlementInbox inbox = new SettlementInbox(keccak256("lp-operation"), address(houseVault), address(token), bytes32(0), 100, borrower, block.timestamp + 1 days);
        houseVault.setSettlementInbox(address(inbox), true);
        houseVault.configureLpInbox(address(inbox), borrower, 100);
        token.mint(address(inbox), 250);
        inbox.notifyAll();
        inbox.settle(250);
        assertEq(inbox.available(), 0);
        assertEq(houseVault.lpInboxMinted(address(inbox)), true);
        assertGe(houseVault.shares(borrower), 100);
    }
}
