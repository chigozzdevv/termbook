// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {AccountFactory} from "../../src/monad/credit/AccountFactory.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {Types} from "../../src/shared/Types.sol";
import {SettlementInbox} from "../../src/monad/routing/SettlementInbox.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {MockHealthSource} from "../MockHealthSource.sol";
import {IHealthSource, IHealthReader, HealthReading} from "../../src/monad/risk/IHealthSource.sol";
import {HealthMath} from "../../src/monad/risk/HealthMath.sol";
import {IExitVerifier} from "../../src/monad/integration/IExitVerifier.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {IAppRecoveryAdapter} from "../../src/monad/integration/IAppRecoveryAdapter.sol";
import {IAppValueReader} from "../../src/monad/integration/IAppValueReader.sol";
import {IAppStateReader} from "../../src/monad/integration/IAppStateReader.sol";
import {AppHealthReader} from "../../src/monad/risk/AppHealthReader.sol";

contract MockExitVerifier is IExitVerifier {
    bool public ready = true;

    function setReady(bool value) external {
        ready = value;
    }

    function canExit(bytes32, address) external view returns (bool) {
        return ready;
    }
}

contract RealFlowTarget {
    uint256 public value;

    function setValue(uint256 value_) external {
        value = value_;
    }
}

contract FakeCollateralVault {
    address public immutable core;
    address public immutable asset;
    uint256 public immutable chainId_;
    bytes32 public immutable fakeCreditId;
    address public immutable fakeOwner;

    constructor(address core_, address asset_, bytes32 creditId_, address owner_) {
        core = core_;
        asset = asset_;
        chainId_ = block.chainid;
        fakeCreditId = creditId_;
        fakeOwner = owner_;
    }

    function lockInfo(bytes32)
        external
        view
        returns (bytes32, address, address, uint256, uint256, address, uint256, uint256, bool, bool, bool)
    {
        return (
            fakeCreditId, fakeOwner, asset, chainId_, 1_000_000, fakeOwner, type(uint256).max, 1, true, false, false
        );
    }
}

contract FundedPositionTarget {
    MockERC20 public immutable token;
    mapping(address => uint256) public positions;

    constructor(MockERC20 token_) {
        token = token_;
    }

    function deposit(uint256 amount) external {
        require(token.transferFrom(msg.sender, address(this), amount));
        positions[msg.sender] += amount;
    }

    function withdraw(uint256 amount) external {
        require(positions[msg.sender] >= amount);
        positions[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount));
    }
}

contract FundedPositionRecoveryAdapter is IAppRecoveryAdapter {
    FundedPositionTarget public immutable target;
    bool public valid = true;

    function setValid(bool value) external {
        valid = value;
    }

    constructor(FundedPositionTarget target_) {
        target = target_;
    }

    function recoveryCall(bytes32, address account, bytes calldata instruction)
        external
        view
        returns (address, bytes memory, bytes32)
    {
        uint256 amount = abi.decode(instruction, (uint256));
        uint256 beforePosition = target.positions(account);
        require(amount > 0 && amount <= beforePosition);
        return (address(target), abi.encodeWithSelector(FundedPositionTarget.withdraw.selector, amount),
            bytes32(beforePosition - amount));
    }

    function verifyRecovery(bytes32, address account, bytes calldata, bytes32 expectedState)
        external
        view
        returns (bool)
    {
        return valid && target.positions(account) == uint256(expectedState);
    }
}

contract BasePositionHealthReader is IHealthReader {
    function readHealth(bytes32, uint256, uint256 debt, address)
        external
        view
        returns (HealthReading memory)
    {
        return HealthReading(debt, 50, 100, 0, 8_000, 0, 5, block.timestamp);
    }
}

contract TestAppValueReader is IAppValueReader, IAppStateReader {
    uint256 public positionsCount;
    uint256 public pendingActionsCount;

    function setCounts(uint256 positions_, uint256 pending_) external {
        positionsCount = positions_;
        pendingActionsCount = pending_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IAppStateReader).interfaceId;
    }

    function positionCount(bytes32, address) external view returns (uint256) {
        return positionsCount;
    }

    function positionAt(bytes32, address, uint256) external pure returns (bytes32, bytes32) {
        revert("no-position");
    }

    function pendingCount(bytes32, address) external view returns (uint256) {
        return pendingActionsCount;
    }

    function pendingAt(bytes32, address, uint256) external pure returns (bytes32, bytes32, uint256, uint256) {
        revert("no-pending");
    }

    function readAppValue(bytes32, address, address)
        external
        view
        returns (int256, uint16, uint128, uint256)
    {
        return (200, 9_000, 10, block.timestamp);
    }
}

contract FundedPositionHealthSource is IHealthSource {
    MockERC20 public immutable token;
    TermbookCore public immutable core;
    FundedPositionTarget public immutable target;
    bool public unavailable;

    function setUnavailable(bool value) external {
        unavailable = value;
    }

    function isReaderActive(bytes32) external pure returns (bool) {
        return true;
    }

    constructor(MockERC20 token_, TermbookCore core_, FundedPositionTarget target_) {
        token = token_;
        core = core_;
        target = target_;
    }

    function snapshot(bytes32 creditId, bytes32, uint256, uint256 debt)
        external
        view
        returns (Types.HealthSnapshot memory)
    {
        require(!unavailable);
        address account = core.creditAccount(creditId);
        uint256 cash = token.balanceOf(account);
        uint256 position = target.positions(account);
        uint256 recovery = cash + 100 + position;
        return Types.HealthSnapshot(
            debt, cash, 100, int256(position), 10_000, 10_000, 0, recovery,
            HealthMath.healthBps(recovery, debt, 0)
        );
    }
}

contract RealFlowTest is Test {
    MockERC20 token;
    TermbookCore core;
    HouseVault houseVault;
    InboxFactory inboxFactory;
    CollateralVault collateralVault;
    AccountFactory accountFactory;
    RiskEngine risk;
    MockHealthSource healthSource;
    MockExitVerifier exitVerifier;
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
        healthSource = new MockHealthSource();
        exitVerifier = new MockExitVerifier();
        core.setRisk(address(risk));
        core.setHealthSource(address(healthSource));
        core.setExitVerifier(keccak256("bundle"), address(exitVerifier));
        inboxFactory = new InboxFactory(address(this));
        houseVault = new HouseVault(address(token), address(core), address(this), address(inboxFactory), address(0));
        collateralVault = new CollateralVault(address(token), block.chainid, address(core));
        core.setLocalCollateralVault(address(collateralVault), address(collateralVault).codehash);
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
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(houseVault),
            limit,
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
            limit,
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
    }

    function acceptGateCredit() external {
        _accept(keccak256("gate-credit"), keccak256("gate-intent"), 500);
    }

    function testAcceptedBundleMustBeActive() public {
        IntegrationRegistry registry = new IntegrationRegistry(address(this));
        core.setIntegrationRegistry(address(registry));
        bytes32 bundleId = keccak256("bundle");
        registry.approve(bundleId, keccak256("manifest"));
        registry.registerCall(bundleId, address(target), RealFlowTarget.setValue.selector,
            36, type(uint8).max, type(uint8).max, 0);
        registry.registerRecoveryCall(bundleId, address(target), RealFlowTarget.setValue.selector, 36, type(uint8).max);
        core.setAppRecoveryAdapter(bundleId,
            address(new FundedPositionRecoveryAdapter(new FundedPositionTarget(token))));
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        this.acceptGateCredit();
        registry.activate(bundleId);
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        this.acceptGateCredit();
        healthSource.setReaderActive(bundleId, true);
        this.acceptGateCredit();
        assertEq(core.creditRevision(keccak256("gate-credit")), 1);
        registry.freeze(bundleId);
        assertFalse(registry.isActive(bundleId));
    }

    function testUnapprovedLocalVaultCannotMakeCreditReady() public {
        bytes32 creditId = keccak256("fake-credit");
        _accept(creditId, keccak256("fake-intent"), 500);
        FakeCollateralVault fake = new FakeCollateralVault(address(core), address(token), creditId, borrower);
        assertEq(token.balanceOf(address(fake)), 0);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.setCollateral(creditId, address(fake), borrower);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.setCollateralWithOwner(creditId, address(fake), borrower, borrower);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.Reserved));
        assertFalse(core.collateralProven(creditId));
    }

    function testLocalQuoteRejectsUnapprovedVault() public {
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("fake-quoted-intent");
        quote.house = house;
        quote.vault = address(houseVault);
        quote.sourceChain = block.chainid;
        quote.nonce = 1;
        bytes32 creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        FakeCollateralVault fake = new FakeCollateralVault(address(core), address(token), creditId, borrower);
        quote.collateralVault = address(fake);
        quote.collateralAsset = address(token);
        quote.collateralAmount = 1_000_000;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(token);
        quote.limit = 500;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.expiry = quote.setupDeadline;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.acceptQuote(quote);
        assertEq(core.creditRevision(creditId), 0);
    }

    function _prepareTerms(bytes32 creditId) internal returns (bytes32 lockId, address account) {
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 2 * 365 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 intentId = keccak256("terms-intent");
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigestWithTerms(
            intentId,
            borrower,
            house,
            address(houseVault),
            500,
            maturity,
            true,
            bundleId,
            setupDeadline,
            0,
            0,
            7,
            expiry,
            termsHash,
            1000,
            10,
            1000
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.prank(borrower);
        core.acceptWithTerms(
            creditId,
            intentId,
            borrower,
            house,
            address(houseVault),
            500,
            maturity,
            true,
            bundleId,
            setupDeadline,
            0,
            0,
            termsHash,
            7,
            expiry,
            1000,
            10,
            1000,
            abi.encodePacked(r, s, v)
        );
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
        _recordHealth(creditId, Types.HealthSnapshot(0, 0, 0, 0, 0, 0, 0, 10_000, 0));
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
        _recordHealth(creditId, snapshot);
    }

    function _recordHealth(bytes32 creditId, Types.HealthSnapshot memory snapshot) internal {
        healthSource.setSnapshot(creditId, snapshot);
        core.recordHealth(creditId);
    }

    function testDrawRepayAndCloseMovesAssets() public {
        bytes32 creditId = keccak256("credit");
        (bytes32 lockId,) = _prepare(creditId);
        assertEq(token.balanceOf(core.creditAccount(creditId)), 0);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(400), uint256(400), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 400, 400, 1, deadline, abi.encodePacked(r, s, v));
        assertEq(token.balanceOf(core.creditAccount(creditId)), 400);
        vm.startPrank(borrower);
        token.approve(address(core), 400);
        core.repay(creditId, 400);
        core.startClosing(creditId);
        _recordHealth(creditId, Types.HealthSnapshot(0, 400, 0, 0, 0, 0, 0, 400, 0));
        core.withdraw(creditId, address(token), borrower, 400);
        core.authorizeReturn(creditId, lockId, 250);
        core.authorizeReturn(creditId, lockId, 250);
        vm.stopPrank();
        core.finishClose(creditId);
        assertEq(token.balanceOf(borrower), 1_000);
    }

    function testClosureRequiresVerifiedExitAndSurplusSweep() public {
        bytes32 creditId = keccak256("exit-gated-credit");
        (bytes32 lockId, address account) = _prepare(creditId);
        token.mint(account, 100);
        vm.prank(borrower);
        core.startClosing(creditId);
        exitVerifier.setReady(false);
        vm.expectRevert(TermbookCore.BadState.selector);
        vm.prank(borrower);
        core.authorizeReturn(creditId, lockId, 500);
        exitVerifier.setReady(true);
        vm.prank(borrower);
        core.authorizeReturn(creditId, lockId, 500);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.finishClose(creditId);
        _recordHealth(creditId, Types.HealthSnapshot(0, 100, 0, 0, 0, 0, 0, 100, 0));
        vm.prank(borrower);
        core.withdraw(creditId, address(token), borrower, 100);
        core.finishClose(creditId);
        assertEq(token.balanceOf(account), 0);
    }

    function testExpiredSetupReleasesReservationWithoutBorrower() public {
        bytes32 creditId = keccak256("expired-setup");
        _accept(creditId, keccak256("expired-intent"), 500);
        assertEq(houseVault.creditCommitted(creditId), 500);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(address(0xD00D));
        core.expireSetup(creditId);

        assertEq(houseVault.creditCommitted(creditId), 0);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.Aborted));
    }

    function testAcceptedCreditSealsServicingDependencies() public {
        bytes32 creditId = keccak256("sealed-configuration");
        _accept(creditId, keccak256("sealed-intent"), 500);
        MockHealthSource replacement = new MockHealthSource();
        vm.expectRevert(TermbookCore.Frozen.selector);
        core.setHealthSource(address(replacement));
        vm.expectRevert(TermbookCore.Frozen.selector);
        core.setApprovedCall(address(target), RealFlowTarget.setValue.selector, false);
        vm.expectRevert(TermbookCore.Frozen.selector);
        core.setHouseProtocolFee(address(houseVault), address(this), 100);
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        core.setExitVerifier(keccak256("bundle"), address(replacement));
    }

    function testInterestFeesAndRepaymentAllocation() public {
        bytes32 creditId = keccak256("terms-credit");
        _prepareTerms(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(400), uint256(400), uint256(1), deadline, revision));
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

    function testFrequentAccrualCannotEraseInterestOrCommitmentFees() public {
        bytes32 creditId = keccak256("accrual-rounding");
        _prepareTerms(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId, uint256(400), uint256(400),
            uint256(1), deadline, core.creditRevision(creditId)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 400, 400, 1, deadline, abi.encodePacked(r, s, v));
        for (uint256 day = 0; day < 365; ++day) {
            vm.warp(block.timestamp + 1 days);
            uint256 previewDebt = core.creditDebt(creditId);
            core.accrue(creditId);
            assertEq(core.creditDebt(creditId), previewDebt);
        }
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        assertEq(credit.accruedInterest, 40);
        assertEq(credit.accruedFees, 20);
        assertEq(credit.debt, 460);
        assertEq(houseVault.accruedReceivables(), 60);
        assertEq(core.interestRemainder(creditId), 0);
        assertEq(core.commitmentFeeRemainder(creditId), 0);
    }

    function testCollateralWithdrawalMaintainsHealthSnapshot() public {
        bytes32 creditId = keccak256("collateral-withdraw-credit");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(200), uint256(200), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 200, 200, 1, deadline, abi.encodePacked(r, s, v));
        _recordHealth(creditId, Types.HealthSnapshot(200, 0, 1000, 0, 10_000, 10_000, 0, 1000, 50_000));
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
        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(200, 200, 1_000, 0, 10_000, 0, 0, 1_200, 60_000)
        );
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes memory data = abi.encodeWithSelector(RealFlowTarget.setValue.selector, 42);
        bytes32 actionHash = keccak256(abi.encode(address(target), data));
        bytes32 digest = keccak256(
            abi.encode(core.domain(), creditId, actionHash, uint256(200), uint256(200), uint256(2), deadline, revision)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.executeAction(creditId, address(target), data, 200, 200, 2, deadline, abi.encodePacked(r, s, v));
        assertEq(target.value(), 42);
        assertEq(core.creditDebt(creditId), 200);
    }

    function testFinancedActionUsesPostActionHealth() public {
        bytes32 creditId = keccak256("financed-action");
        _prepare(creditId);
        _recordHealth(creditId, Types.HealthSnapshot(0, 0, 100, 0, 10_000, 0, 0, 100, 0));
        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(200, 0, 400, 0, 10_000, 0, 0, 400, 20_000)
        );
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory data = abi.encodeWithSelector(RealFlowTarget.setValue.selector, 42);
        bytes32 digest = keccak256(
            abi.encode(
                core.domain(), creditId, keccak256(abi.encode(address(target), data)), uint256(200), uint256(200),
                uint256(7), deadline, core.creditRevision(creditId)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.executeAction(creditId, address(target), data, 200, 200, 7, deadline, abi.encodePacked(r, s, v));
        assertEq(target.value(), 42);
        assertEq(core.creditDebt(creditId), 200);
        assertEq(risk.health(creditId), 20_000);
    }

    function testFinancedDepositCreatesRecoverablePosition() public {
        bytes32 creditId = keccak256("financed-position");
        FundedPositionTarget positionTarget = new FundedPositionTarget(token);
        FundedPositionHealthSource positionHealth = new FundedPositionHealthSource(token, core, positionTarget);
        core.setHealthSource(address(positionHealth));
        core.setAppRecoveryAdapter(keccak256("bundle"), address(new FundedPositionRecoveryAdapter(positionTarget)));
        core.setApprovedCall(address(positionTarget), FundedPositionTarget.deposit.selector, true);
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory data = abi.encodeWithSelector(FundedPositionTarget.deposit.selector, 200);
        bytes32 digest = keccak256(
            abi.encode(
                core.domain(), creditId, keccak256(abi.encode(address(positionTarget), data)), uint256(200),
                uint256(200), uint256(10), deadline, core.creditRevision(creditId)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.executeAction(creditId, address(positionTarget), data, 200, 200, 10, deadline, abi.encodePacked(r, s, v));
        address account = core.creditAccount(creditId);
        assertEq(positionTarget.positions(account), 200);
        assertEq(token.balanceOf(account), 0);
        assertEq(token.allowance(account, address(positionTarget)), 0);
        assertEq(risk.health(creditId), 15_000);
    }

    function testPreviewReportsPostActionHealthAndRollsBack() public {
        bytes32 creditId = keccak256("preview-position");
        FundedPositionTarget positionTarget = new FundedPositionTarget(token);
        FundedPositionHealthSource positionHealth = new FundedPositionHealthSource(token, core, positionTarget);
        core.setHealthSource(address(positionHealth));
        core.setAppRecoveryAdapter(keccak256("bundle"), address(new FundedPositionRecoveryAdapter(positionTarget)));
        core.setApprovedCall(address(positionTarget), FundedPositionTarget.deposit.selector, true);
        _prepare(creditId);
        address account = core.creditAccount(creditId);
        uint256 revision = core.creditRevision(creditId);
        bytes memory data = abi.encodeWithSelector(FundedPositionTarget.deposit.selector, 200);
        vm.expectRevert(abi.encodeWithSelector(TermbookCore.ActionPreview.selector, 15_000, 15_000, 200, 300));
        core.previewAction(creditId, address(positionTarget), data, 200, 10);
        assertEq(core.creditDebt(creditId), 0);
        assertEq(core.creditRevision(creditId), revision);
        assertEq(positionTarget.positions(account), 0);
        assertEq(token.balanceOf(account), 0);
        assertEq(token.allowance(account, address(positionTarget)), 0);
        assertEq(houseVault.creditCommitted(creditId), 500);
    }

    function testFuzzFundedActionUsesCashAndOnlyBorrowsShortfall(uint256 cash) public {
        cash = bound(cash, 0, 200);
        bytes32 creditId = keccak256("cash-funded-position");
        FundedPositionTarget positionTarget = new FundedPositionTarget(token);
        core.setHealthSource(address(new FundedPositionHealthSource(token, core, positionTarget)));
        core.setAppRecoveryAdapter(keccak256("bundle"), address(new FundedPositionRecoveryAdapter(positionTarget)));
        core.setApprovedCall(address(positionTarget), FundedPositionTarget.deposit.selector, true);
        (, address account) = _prepare(creditId);
        token.mint(account, cash);
        uint256 drawAmount = 200 - cash;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory data = abi.encodeWithSelector(FundedPositionTarget.deposit.selector, 200);
        bytes32 digest = keccak256(abi.encode(
            core.domain(), keccak256("Termbook funded action v1"), creditId,
            keccak256(abi.encode(address(positionTarget), data)), drawAmount, uint256(200), drawAmount,
            uint256(10), deadline, core.creditRevision(creditId)
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        vm.expectRevert(TermbookCore.BadSig.selector);
        core.executeFundedAction(creditId, address(positionTarget), data, drawAmount, 201,
            drawAmount, 10, deadline, signature);
        core.executeFundedAction(creditId, address(positionTarget), data, drawAmount, 200,
            drawAmount, 10, deadline, signature);
        assertEq(positionTarget.positions(account), 200);
        assertEq(core.creditDebt(creditId), drawAmount);
        assertEq(token.balanceOf(account), 0);
        assertEq(token.allowance(account, address(positionTarget)), 0);
    }

    function testKeeperClosesAppPositionAndRepaysHouse() public {
        bytes32 creditId = keccak256("app-recovery-position");
        FundedPositionTarget positionTarget = new FundedPositionTarget(token);
        core.setHealthSource(address(new FundedPositionHealthSource(token, core, positionTarget)));
        core.setAppRecoveryAdapter(keccak256("bundle"), address(new FundedPositionRecoveryAdapter(positionTarget)));
        core.setApprovedCall(address(positionTarget), FundedPositionTarget.deposit.selector, true);
        _prepare(creditId);
        bytes memory data = abi.encodeWithSelector(FundedPositionTarget.deposit.selector, 200);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId,
            keccak256(abi.encode(address(positionTarget), data)), uint256(200), uint256(200),
            uint256(10), deadline, core.creditRevision(creditId)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.executeAction(creditId, address(positionTarget), data, 200, 200, 10, deadline, abi.encodePacked(r, s, v));
        address account = core.creditAccount(creditId);
        vm.warp(block.timestamp + 30 days + 1);
        core.markDefaulted(creditId);
        core.startLiquidation(creditId);
        vm.expectRevert(TermbookCore.Unauthorized.selector);
        core.recoverApp(creditId, abi.encode(uint256(200)));
        core.setRecoveryKeeper(address(this), true);
        vm.expectRevert();
        core.recoverApp(creditId, abi.encode(uint256(201)));
        core.recoverApp(creditId, abi.encode(uint256(200)));
        assertEq(positionTarget.positions(account), 0);
        assertEq(token.balanceOf(account), 200);
        core.recoverAccountCash(creditId, 200);
        assertEq(core.creditDebt(creditId), 0);
        assertEq(token.balanceOf(account), 0);
        assertEq(houseVault.drawnPrincipal(), 0);
    }

    function testBorrowerExitWorksDuringPauseAndFrozenIntegration() public {
        bytes32 creditId = keccak256("borrower-exit");
        bytes32 bundleId = keccak256("bundle");
        FundedPositionTarget positionTarget = new FundedPositionTarget(token);
        FundedPositionHealthSource source = new FundedPositionHealthSource(token, core, positionTarget);
        FundedPositionRecoveryAdapter adapter = new FundedPositionRecoveryAdapter(positionTarget);
        core.setHealthSource(address(source));
        core.setAppRecoveryAdapter(bundleId, address(adapter));
        IntegrationRegistry registry = new IntegrationRegistry(address(this));
        core.setIntegrationRegistry(address(registry));
        registry.approve(bundleId, keccak256("exit-manifest"));
        registry.registerCall(bundleId, address(positionTarget), FundedPositionTarget.deposit.selector,
            36, type(uint8).max, 0, 500);
        registry.registerRecoveryCall(bundleId, address(positionTarget), FundedPositionTarget.withdraw.selector,
            36, type(uint8).max);
        registry.activate(bundleId);
        (, address account) = _prepare(creditId);
        bytes memory data = abi.encodeWithSelector(FundedPositionTarget.deposit.selector, 200);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId,
            keccak256(abi.encode(address(positionTarget), data)), uint256(200), uint256(200),
            uint256(10), deadline, core.creditRevision(creditId)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.executeAction(creditId, address(positionTarget), data, 200, 200, 10, deadline, abi.encodePacked(r, s, v));
        core.setPaused(true);
        registry.freeze(bundleId);
        source.setUnavailable(true);
        vm.warp(core.creditDetails(creditId).maturity);
        vm.expectRevert(TermbookCore.Unauthorized.selector);
        core.exitApp(creditId, abi.encode(uint256(100)));
        adapter.setValid(false);
        vm.expectRevert(TermbookCore.BadState.selector);
        vm.prank(borrower);
        core.exitApp(creditId, abi.encode(uint256(100)));
        assertEq(positionTarget.positions(account), 200);
        adapter.setValid(true);
        vm.prank(borrower);
        core.exitApp(creditId, abi.encode(uint256(100)));
        assertEq(positionTarget.positions(account), 100);
        assertEq(token.balanceOf(account), 100);
        assertEq(token.balanceOf(borrower), 500);
        assertEq(core.creditDebt(creditId), 200);
        registry.disableRecoveryCall(bundleId, address(positionTarget), FundedPositionTarget.withdraw.selector);
        vm.expectRevert(TermbookCore.BadHealth.selector);
        vm.prank(borrower);
        core.exitApp(creditId, abi.encode(uint256(100)));
    }

    function testAppActionsCannotBorrowOrSpendAfterMaturity() public {
        bytes32 creditId = keccak256("matured-app-action");
        _prepare(creditId);
        vm.warp(core.creditDetails(creditId).maturity);
        bytes memory data = abi.encodeWithSelector(RealFlowTarget.setValue.selector, 99);
        vm.expectRevert(TermbookCore.Expired.selector);
        core.executeAction(creditId, address(target), data, 100, 100, 1, block.timestamp + 1 hours, "");
        vm.expectRevert(TermbookCore.Expired.selector);
        core.executeFundedAction(creditId, address(target), data, 100, 100, 100, 1, block.timestamp + 1 hours, "");
        vm.expectRevert(TermbookCore.Expired.selector);
        core.previewFundedAction(creditId, address(target), data, 0, 100, 1);
        assertEq(core.creditDebt(creditId), 0);
        assertEq(target.value(), 0);
    }

    function testNewDebtAfterRepaymentCanDefault() public {
        bytes32 creditId = keccak256("redraw-default");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        for (uint256 nonce = 1; nonce <= 2; ++nonce) {
            _recordHealth(creditId, Types.HealthSnapshot(0, 0, 0, 0, 0, 0, 0, 10_000, 0));
            bytes32 digest = keccak256(abi.encode(core.domain(), creditId, uint256(100), uint256(100),
                nonce, deadline, core.creditRevision(creditId)));
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
            core.draw(creditId, 100, 100, nonce, deadline, abi.encodePacked(r, s, v));
            assertEq(uint256(core.creditDetails(creditId).payment), uint256(Types.Payment.Current));
            if (nonce == 1) {
                vm.startPrank(borrower);
                token.approve(address(core), 100);
                core.repay(creditId, 100);
                vm.stopPrank();
                assertEq(uint256(core.creditDetails(creditId).payment), uint256(Types.Payment.Repaid));
            }
        }
        vm.warp(core.creditDetails(creditId).maturity + 1);
        core.markDefaulted(creditId);
        assertEq(uint256(core.creditDetails(creditId).payment), uint256(Types.Payment.Defaulted));
        vm.startPrank(borrower);
        token.approve(address(core), 100);
        core.repay(creditId, 100);
        vm.stopPrank();
        assertEq(uint256(core.creditDetails(creditId).payment), uint256(Types.Payment.Repaid));
    }

    function testAccruedCommitmentFeesAfterRepaymentCanDefault() public {
        bytes32 creditId = keccak256("commitment-default");
        _prepareTerms(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), creditId, uint256(100), uint256(100),
            uint256(1), deadline, core.creditRevision(creditId)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 100, 100, 1, deadline, abi.encodePacked(r, s, v));
        vm.startPrank(borrower);
        token.approve(address(core), 110);
        core.repay(creditId, 110);
        vm.stopPrank();
        assertEq(uint256(core.creditDetails(creditId).payment), uint256(Types.Payment.Repaid));
        vm.warp(core.creditDetails(creditId).maturity + 1);
        core.markDefaulted(creditId);
        assertGt(core.creditDebt(creditId), 0);
        assertEq(uint256(core.creditDetails(creditId).payment), uint256(Types.Payment.Defaulted));
    }

    function testAppHealthReaderCombinesCollateralAndAppRecoveryValue() public {
        bytes32 creditId = keccak256("app-health-reader");
        FundedPositionTarget positionTarget = new FundedPositionTarget(token);
        address adapter = address(new FundedPositionRecoveryAdapter(positionTarget));
        core.setAppRecoveryAdapter(keccak256("bundle"), adapter);
        _prepare(creditId);
        BasePositionHealthReader base = new BasePositionHealthReader();
        TestAppValueReader appValue = new TestAppValueReader();
        vm.expectRevert(AppHealthReader.Invalid.selector);
        new AppHealthReader(address(core), keccak256("bundle"), address(base), address(base), adapter);
        AppHealthReader reader = new AppHealthReader(address(core), keccak256("bundle"),
            address(base), address(appValue), adapter);
        HealthReading memory reading = reader.readHealth(creditId, core.creditRevision(creditId), 200, address(1));
        assertEq(reading.cash, 50);
        assertEq(reading.sourceValue, 100);
        assertEq(reading.appValue, 200);
        assertEq(reading.retainedSource, 8_000);
        assertEq(reading.retainedApp, 9_000);
        assertEq(reading.recoveryCosts, 15);
        uint256 revision = core.creditRevision(creditId);
        appValue.setCounts(33, 0);
        vm.expectRevert(AppHealthReader.Invalid.selector);
        reader.readHealth(creditId, revision, 200, address(1));
        appValue.setCounts(0, 0);
        vm.etch(address(appValue), hex"6000");
        vm.expectRevert(AppHealthReader.Invalid.selector);
        reader.readHealth(creditId, revision, 200, address(1));
    }

    function testUnsafeFinancedActionRevertsDrawAndAction() public {
        bytes32 creditId = keccak256("unsafe-action");
        _prepare(creditId);
        _recordHealth(creditId, Types.HealthSnapshot(0, 0, 100, 0, 10_000, 0, 0, 100, 0));
        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(200, 0, 100, 0, 10_000, 0, 0, 100, 5_000)
        );
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory data = abi.encodeWithSelector(RealFlowTarget.setValue.selector, 99);
        vm.expectRevert(abi.encodeWithSelector(TermbookCore.ActionPreview.selector, 5_000, 15_000, 200, 100));
        core.previewAction(creditId, address(target), data, 200, 8);
        assertEq(target.value(), 0);
        assertEq(core.creditDebt(creditId), 0);
        bytes32 digest = keccak256(
            abi.encode(
                core.domain(), creditId, keccak256(abi.encode(address(target), data)), uint256(200), uint256(200),
                uint256(8), deadline, core.creditRevision(creditId)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        vm.expectRevert(RiskEngine.Frozen.selector);
        core.executeAction(creditId, address(target), data, 200, 200, 8, deadline, abi.encodePacked(r, s, v));
        assertEq(target.value(), 0);
        assertEq(core.creditDebt(creditId), 0);
        assertEq(houseVault.creditCommitted(creditId), 500);
    }

    function testZeroDrawActionCannotReduceHealthBelowInitial() public {
        bytes32 creditId = keccak256("zero-draw-action");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 drawDigest = keccak256(
            abi.encode(core.domain(), creditId, uint256(200), uint256(200), uint256(1), deadline, core.creditRevision(creditId))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, drawDigest);
        core.draw(creditId, 200, 200, 1, deadline, abi.encodePacked(r, s, v));
        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(200, 0, 100, 0, 10_000, 0, 0, 100, 5_000)
        );
        bytes memory data = abi.encodeWithSelector(RealFlowTarget.setValue.selector, 99);
        bytes32 actionDigest = keccak256(
            abi.encode(
                core.domain(), creditId, keccak256(abi.encode(address(target), data)), uint256(0), uint256(0),
                uint256(9), deadline, core.creditRevision(creditId)
            )
        );
        (v, r, s) = vm.sign(borrowerKey, actionDigest);
        vm.expectRevert(RiskEngine.Frozen.selector);
        core.executeAction(creditId, address(target), data, 0, 0, 9, deadline, abi.encodePacked(r, s, v));
        assertEq(target.value(), 0);
    }

    function testStaleHealthBlocksNewDraw() public {
        bytes32 creditId = keccak256("stale-health-credit");
        _prepare(creditId);
        vm.warp(block.timestamp + core.healthMaxAge() + 1);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(100), uint256(100), uint256(3), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        vm.expectRevert(TermbookCore.BadHealth.selector);
        core.draw(creditId, 100, 100, 3, deadline, abi.encodePacked(r, s, v));
    }

    function testStaleHealthBlocksAccountWithdrawal() public {
        bytes32 creditId = keccak256("stale-withdrawal-credit");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(200), uint256(200), uint256(6), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 200, 200, 6, deadline, abi.encodePacked(r, s, v));
        _recordHealth(creditId, Types.HealthSnapshot(200, 200, 1000, 0, 10_000, 10_000, 0, 1200, 60_000));
        vm.warp(block.timestamp + core.healthMaxAge() + 1);
        vm.expectRevert(TermbookCore.BadHealth.selector);
        vm.prank(borrower);
        core.withdraw(creditId, address(token), borrower, 50);
    }

    function testWithdrawalCannotConsumeCashExcludedFromVerifiedFreeBalance() public {
        bytes32 creditId = keccak256("reserved-account-cash");
        (, address account) = _prepare(creditId);
        token.mint(account, 100);
        _recordHealth(creditId, Types.HealthSnapshot(0, 20, 1_000, 0, 10_000, 10_000, 0, 1_020, 0));
        vm.expectRevert(TermbookCore.OverLimit.selector);
        vm.prank(borrower);
        core.withdraw(creditId, address(token), borrower, 21);
        assertEq(token.balanceOf(account), 100);
    }

    function testAccountRepaymentCannotConsumeReservedCash() public {
        bytes32 creditId = keccak256("reserved-repayment-cash");
        (, address account) = _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encode(core.domain(), creditId, uint256(200), uint256(200), uint256(8), deadline, core.creditRevision(creditId))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 200, 200, 8, deadline, abi.encodePacked(r, s, v));
        _recordHealth(creditId, Types.HealthSnapshot(200, 50, 1_000, 0, 10_000, 10_000, 0, 1_050, 52_500));
        vm.expectRevert(TermbookCore.OverLimit.selector);
        vm.prank(borrower);
        core.repayFromAccount(creditId, 51);
        vm.prank(borrower);
        core.repayFromAccount(creditId, 50);
        assertEq(token.balanceOf(account), 150);
        assertEq(core.creditDebt(creditId), 150);
    }

    function testHealthSnapshotMustMatchCreditRevision() public {
        bytes32 creditId = keccak256("revision-health-credit");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(100), uint256(100), uint256(4), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 100, 100, 4, deadline, abi.encodePacked(r, s, v));

        revision = core.creditRevision(creditId);
        digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(100), uint256(100), uint256(5), deadline, revision));
        (v, r, s) = vm.sign(borrowerKey, digest);
        vm.expectRevert(TermbookCore.BadHealth.selector);
        core.draw(creditId, 100, 100, 5, deadline, abi.encodePacked(r, s, v));
    }

    function testBondSettlementAndRevolvingCapacity() public {
        bytes32 creditId = keccak256("bond-credit");
        bytes32 intentId = keccak256("bond-intent");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(houseVault),
            500,
            maturity,
            true,
            bundleId,
            setupDeadline,
            0,
            50,
            9,
            expiry,
            termsHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        token.mint(borrower, 50);
        vm.startPrank(borrower);
        token.approve(address(houseVault), 50);
        core.acceptWithBond(
            creditId,
            intentId,
            borrower,
            house,
            address(houseVault),
            500,
            maturity,
            true,
            bundleId,
            setupDeadline,
            0,
            50,
            termsHash,
            9,
            expiry,
            abi.encodePacked(r, s, v)
        );
        vm.stopPrank();
        assertEq(houseVault.bondLiabilities(), 50);
        (bytes32 lockId,) = _prepareAfterAccept(creditId);
        assertEq(lockId, keccak256("lock"));
        assertEq(houseVault.bondLiabilities(), 0);
        assertEq(houseVault.creditCommitted(creditId), 500);
        uint256 firstRevision = core.creditRevision(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 drawDigest = keccak256(
            abi.encode(core.domain(), creditId, uint256(400), uint256(400), uint256(1), deadline, firstRevision)
        );
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
        _recordHealth(creditId, Types.HealthSnapshot(0, 0, 0, 0, 0, 0, 0, 10_000, 0));
    }

    function testInboxSettlementUpdatesDebtAtomically() public {
        bytes32 creditId = keccak256("inbox-credit");
        _prepare(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest =
            keccak256(abi.encode(core.domain(), creditId, uint256(300), uint256(300), uint256(1), deadline, revision));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 300, 300, 1, deadline, abi.encodePacked(r, s, v));
        SettlementInbox inbox = SettlementInbox(inboxFactory.create(
            keccak256("repay-operation"), address(houseVault), address(token), creditId, 300, 300, borrower, deadline
        ));
        houseVault.setSettlementInbox(address(inbox), true);
        token.mint(address(inbox), 300);
        inbox.notifyAll();
        inbox.settle(300);
        assertEq(core.creditDebt(creditId), 0);
        assertEq(inbox.available(), 0);
        assertEq(houseVault.pendingSettlement(), 0);
    }

    function testLpInboxMintsSharesAtomically() public {
        SettlementInbox inbox = SettlementInbox(inboxFactory.create(
            keccak256("lp-operation"),
            address(houseVault),
            address(token),
            bytes32(0),
            100,
            250,
            borrower,
            block.timestamp + 1 days
        ));
        houseVault.setSettlementInbox(address(inbox), true);
        vm.prank(borrower);
        houseVault.configureLpInbox(address(inbox), borrower, 100);
        token.mint(address(inbox), 250);
        inbox.notifyAll();
        inbox.settle(250);
        assertEq(inbox.available(), 0);
        assertEq(houseVault.lpInboxMinted(address(inbox)), true);
        assertGe(houseVault.shares(borrower), 100);
    }
}
