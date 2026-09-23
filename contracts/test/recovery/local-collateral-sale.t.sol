// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockHealthSource} from "../MockHealthSource.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {RiskEngine} from "../../src/risk/RiskEngine.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {NativeCollateralVault} from "../../src/collateral/NativeCollateralVault.sol";
import {AccountFactory} from "../../src/credit/AccountFactory.sol";
import {OracleRegistry, IAggregatorV3} from "../../src/risk/OracleRegistry.sol";
import {CollateralHealthReader} from "../../src/risk/CollateralHealthReader.sol";
import {HealthReading} from "../../src/risk/IHealthSource.sol";
import {IExitVerifier} from "../../src/integration/IExitVerifier.sol";
import {Types} from "../../src/shared/Types.sol";

contract MockSaleExitVerifier is IExitVerifier {
    function canExit(bytes32, address) external pure returns (bool) {
        return true;
    }
}

contract MockSaleFeed is IAggregatorV3 {
    uint8 public constant decimals = 8;
    int256 public answer = 5e8;
    uint256 public updatedAt = block.timestamp;

    function setPrice(int256 price, uint256 updated) external {
        answer = price;
        updatedAt = updated;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract MockSaleUsdc {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (balanceOf[from] < amount || allowance[from][msg.sender] < amount) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockSaleWrappedMon {
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract LocalCollateralSaleTest is Test {
    MockSaleUsdc usdc;
    MockERC20 mon;
    TermbookCore core;
    RiskEngine risk;
    HouseVault houseVault;
    CollateralVault collateralVault;
    AccountFactory accounts;
    MockHealthSource healthSource;
    OracleRegistry oracle;
    MockSaleFeed feed;
    bytes32 priceId = keccak256("MON/USDC");
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;
    address house;
    address borrower;
    address buyer;

    function setUp() public {
        usdc = new MockSaleUsdc();
        mon = new MockERC20();
        core = new TermbookCore(address(this), address(this), address(0));
        risk = new RiskEngine(address(core));
        healthSource = new MockHealthSource();
        oracle = new OracleRegistry(address(this));
        feed = new MockSaleFeed();
        oracle.setFeed(priceId, address(feed), 1 days, 8);
        houseVault = new HouseVault(address(usdc), address(core), address(this), address(0), address(0));
        collateralVault = new CollateralVault(address(mon), block.chainid, address(core));
        core.setLocalCollateralVault(address(collateralVault), address(collateralVault).codehash);
        accounts = new AccountFactory();
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        buyer = vm.addr(0xABCD);
        core.setRisk(address(risk));
        core.setHealthSource(address(healthSource));
        core.setExitVerifier(keccak256("bundle"), address(new MockSaleExitVerifier()));
        core.setLocalSalePolicy(address(mon), address(usdc), address(oracle), priceId, 9_000, 1_000e18);
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(houseVault), 1_000e6);
        houseVault.deposit(address(this), 1_000e6);
        mon.mint(borrower, 100e18);
        usdc.mint(buyer, 1_000e6);
        vm.prank(buyer);
        usdc.approve(address(core), type(uint256).max);
    }

    function _recordHealth(bytes32 creditId, Types.HealthSnapshot memory snapshot) internal {
        healthSource.setSnapshot(creditId, snapshot);
        core.recordHealth(creditId);
    }

    function _prepare(bytes32 creditId) internal returns (bytes32 lockId) {
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        bytes32 intentId = keccak256(abi.encode(creditId, "intent"));
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(houseVault),
            500e6,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            0,
            1,
            setupDeadline,
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
            500e6,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            termsHash,
            1,
            setupDeadline,
            abi.encodePacked(r, s, v)
        );
        vm.startPrank(borrower);
        mon.approve(address(collateralVault), 100e18);
        core.setCollateral(creditId, address(collateralVault), borrower);
        lockId = keccak256(abi.encode(creditId, "lock"));
        collateralVault.lock(lockId, creditId, borrower, 100e18, borrower);
        core.bindCollateral(creditId, lockId);
        address account = accounts.create(creditId, borrower, address(core));
        core.bindAccount(creditId, account);
        vm.stopPrank();
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        _recordHealth(creditId, Types.HealthSnapshot(0, 0, 500e6, 500e6, 10_000, 10_000, 0, 1_000e6, 0));
    }

    function _drawAndLiquidate(bytes32 creditId) internal {
        uint256 deadline = block.timestamp + 1 hours;
        uint256 revision = core.creditRevision(creditId);
        bytes32 digest = keccak256(
            abi.encode(core.domain(), creditId, uint256(500e6), uint256(500e6), uint256(1), deadline, revision)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 500e6, 500e6, 1, deadline, abi.encodePacked(r, s, v));
        _recordHealth(creditId, Types.HealthSnapshot(500e6, 0, 0, 0, 10_000, 0, 0, 0, 0));
        core.startLiquidation(creditId);
    }

    function testBuyerPaysUsdcAndReceivesMonAtomically() public {
        bytes32 creditId = keccak256("mon-sale");
        bytes32 lockId = _prepare(creditId);
        _drawAndLiquidate(creditId);

        vm.prank(buyer);
        core.recoverLocalCollateralWithBid(creditId, 100e18, 450e6);

        assertEq(core.creditDebt(creditId), 50e6);
        assertEq(houseVault.drawnPrincipal(), 50e6);
        assertEq(usdc.balanceOf(address(houseVault)), 950e6);
        assertEq(mon.balanceOf(buyer), 100e18);
        (,, uint256 remaining,,,) = collateralVault.locks(lockId);
        assertEq(remaining, 0);
    }

    function testUnderpricedBidCannotSeizeCollateral() public {
        bytes32 creditId = keccak256("underpriced");
        _prepare(creditId);
        _drawAndLiquidate(creditId);

        vm.prank(buyer);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.recoverLocalCollateralWithBid(creditId, 100e18, 449e6);
        assertEq(mon.balanceOf(buyer), 0);
        assertEq(core.creditDebt(creditId), 500e6);
    }

    function testStaleOracleBlocksSale() public {
        bytes32 creditId = keccak256("stale");
        _prepare(creditId);
        _drawAndLiquidate(creditId);
        vm.warp(block.timestamp + 2 days);

        vm.prank(buyer);
        vm.expectRevert(OracleRegistry.StaleFeed.selector);
        core.recoverLocalCollateralWithBid(creditId, 100e18, 450e6);
        assertEq(mon.balanceOf(buyer), 0);
    }

    function testDisabledPolicyBlocksSale() public {
        bytes32 creditId = keccak256("disabled");
        _prepare(creditId);
        _drawAndLiquidate(creditId);
        core.disableLocalSalePolicy(address(mon), address(usdc));

        vm.prank(buyer);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.recoverLocalCollateralWithBid(creditId, 100e18, 450e6);
    }

    function testDifferentCollateralRequiresSalePolicyBeforeLock() public {
        core.disableLocalSalePolicy(address(mon), address(usdc));
        bytes32 creditId = keccak256("unapproved-market");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        bytes32 intentId = keccak256("unapproved-intent");
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(houseVault),
            500e6,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            0,
            1,
            setupDeadline,
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
            500e6,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            termsHash,
            1,
            setupDeadline,
            abi.encodePacked(r, s, v)
        );
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.setCollateral(creditId, address(collateralVault), borrower);
    }

    function testHealthReaderValuesTheBoundLockInUsdc() public {
        bytes32 creditId = keccak256("health-reader");
        _prepare(creditId);
        CollateralHealthReader reader = new CollateralHealthReader(address(core), address(this), address(oracle));
        reader.setMarket(block.chainid, address(mon), address(usdc), priceId, 18, 9_000, 5e6);

        HealthReading memory reading = reader.readHealth(creditId, core.creditRevision(creditId), 0, address(oracle));
        assertEq(reading.sourceValue, 500e6);
        assertEq(reading.cash, 0);
        assertEq(reading.retainedSource, 9_000);
        assertEq(reading.recoveryCosts, 5e6);

        uint256 revision = core.creditRevision(creditId);
        vm.expectRevert(CollateralHealthReader.InvalidCredit.selector);
        reader.readHealth(creditId, revision + 1, 0, address(oracle));
        core.disableLocalSalePolicy(address(mon), address(usdc));
        vm.expectRevert(CollateralHealthReader.InvalidMarket.selector);
        reader.readHealth(creditId, revision, 0, address(oracle));
    }

    function testHealthReaderRejectsStalePrice() public {
        bytes32 creditId = keccak256("health-stale");
        _prepare(creditId);
        CollateralHealthReader reader = new CollateralHealthReader(address(core), address(this), address(oracle));
        reader.setMarket(block.chainid, address(mon), address(usdc), priceId, 18, 9_000, 5e6);
        vm.warp(block.timestamp + 2 days);

        uint256 revision = core.creditRevision(creditId);
        vm.expectRevert(OracleRegistry.StaleFeed.selector);
        reader.readHealth(creditId, revision, 0, address(oracle));
    }

    function testRepaidLiquidationReturnsUnsoldCollateral() public {
        bytes32 creditId = keccak256("surplus-return");
        bytes32 lockId = _prepare(creditId);
        _drawAndLiquidate(creditId);

        vm.prank(buyer);
        core.recoverLocalCollateralWithBid(creditId, 20e18, 90e6);
        usdc.mint(borrower, 410e6);
        vm.startPrank(borrower);
        usdc.approve(address(core), 410e6);
        core.repay(creditId, 410e6);
        assertEq(core.creditDebt(creditId), 0);
        core.authorizeReturn(creditId, lockId, 80e18);
        vm.stopPrank();

        assertEq(mon.balanceOf(borrower), 80e18);
        (,, uint256 remaining,, bool released,) = collateralVault.locks(lockId);
        assertEq(remaining, 0);
        assertTrue(released);
    }

    function testNativeMonLockSaleAndSurplusReturn() public {
        MockSaleWrappedMon wrapped = new MockSaleWrappedMon();
        NativeCollateralVault nativeVault = new NativeCollateralVault(address(wrapped), block.chainid, address(core));
        core.setLocalCollateralVault(address(nativeVault), address(nativeVault).codehash);
        core.setLocalSalePolicy(address(wrapped), address(usdc), address(oracle), priceId, 9_000, 1_000e18);
        bytes32 creditId = keccak256("native-mon-credit");
        bytes32 lockId = keccak256("native-mon-lock");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        bytes32 intentId = keccak256("native-mon-intent");
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(houseVault),
            500e6,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            0,
            1,
            setupDeadline,
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
            500e6,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            termsHash,
            1,
            setupDeadline,
            abi.encodePacked(r, s, v)
        );
        vm.deal(borrower, 100e18);
        vm.startPrank(borrower);
        core.setCollateral(creditId, address(nativeVault), borrower);
        nativeVault.lockNativeWithDeadline{value: 100e18}(
            lockId, creditId, borrower, 100e18, borrower, setupDeadline, core.creditRevision(creditId)
        );
        core.bindCollateral(creditId, lockId);
        address account = accounts.create(creditId, borrower, address(core));
        core.bindAccount(creditId, account);
        vm.stopPrank();
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        _recordHealth(creditId, Types.HealthSnapshot(0, 0, 500e6, 500e6, 10_000, 10_000, 0, 1_000e6, 0));
        _drawAndLiquidate(creditId);

        vm.prank(buyer);
        core.recoverLocalCollateralWithBid(creditId, 20e18, 90e6);
        assertEq(wrapped.balanceOf(buyer), 20e18);
        usdc.mint(borrower, 410e6);
        vm.startPrank(borrower);
        usdc.approve(address(core), 410e6);
        core.repay(creditId, 410e6);
        core.authorizeReturn(creditId, lockId, 80e18);
        vm.stopPrank();

        assertEq(borrower.balance, 80e18);
        assertEq(core.creditDebt(creditId), 0);
        assertEq(wrapped.balanceOf(address(nativeVault)), 0);
    }
}
