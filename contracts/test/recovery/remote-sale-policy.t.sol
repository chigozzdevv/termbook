// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/collateral/VerifierRegistry.sol";
import {Types} from "../../src/shared/Types.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";
import {CreditAccount} from "../../src/credit/CreditAccount.sol";
import {RiskEngine} from "../../src/risk/RiskEngine.sol";
import {MockHealthSource} from "../MockHealthSource.sol";

contract MockRemotePolicyVerifier {
    function admission() external pure returns (uint256, uint256, bytes32) {
        return (99, 1, keccak256("remote-bootstrap"));
    }

    function lightClient() external view returns (address) {
        return address(this);
    }

    function proofMaxAge() external pure returns (uint256) {
        return 1 days;
    }

    function chainId() external pure returns (uint256) {
        return 99;
    }

    function consensusVersion() external pure returns (uint256) {
        return 1;
    }

    function bootstrapHash() external pure returns (bytes32) {
        return keccak256("remote-bootstrap");
    }

    function verifyLock(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) {
        return true;
    }

    function verifyEvent(bytes calldata, bytes calldata proof, address emitter, bytes32 digest)
        external pure returns (bool)
    {
        return emitter == address(0x4567) && abi.decode(proof, (bytes32)) == digest;
    }
}

contract RemoteReturnExitVerifier {
    function canExit(bytes32, address) external pure returns (bool) { return true; }
}

contract RemoteSalePolicyTest is Test {
    MockERC20 private settlement;
    MockRemoteSaleOracle private oracle;
    TermbookCore private core;
    HouseVault private vault;
    VerifierRegistry private registry;
    address private sourceAsset = address(0x1234);
    uint256 private houseKey = 0xBEEF;
    uint256 private borrowerKey = 0xCAFE;
    bytes32 private priceId = keccak256("ETH/settlement");

    function setUp() public {
        settlement = new MockERC20();
        oracle = new MockRemoteSaleOracle();
        core = new TermbookCore(address(this), address(this), address(0));
        vault = new HouseVault(address(settlement), address(core), address(this), address(0), address(0));
        registry = new VerifierRegistry(address(this));
        core.setVerifierRegistry(address(registry));
        registry.setVerifier(99, address(new MockRemotePolicyVerifier()), 1, 1 days);
        core.setSourceCollateralVault(99, sourceAsset, address(0x4567));
        core.setSourceRecoveryVault(99, sourceAsset, address(0x789A));
        core.setRemoteSalePolicy(
            99, sourceAsset, address(settlement), address(oracle), priceId, 18, 9_000, 1_000e18
        );
        settlement.mint(address(this), 1_000e18);
        settlement.approve(address(vault), 1_000e18);
        vault.deposit(address(this), 1_000e18);
    }

    function _accept() private returns (bytes32 creditId) {
        return _accept(false);
    }

    function _accept(bool expectFailure) private returns (bytes32 creditId) {
        address borrower = vm.addr(borrowerKey);
        address house = vm.addr(houseKey);
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("remote-policy-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = 99;
        quote.collateralVault = address(0x4567);
        quote.collateralAsset = sourceAsset;
        quote.collateralAmount = 100e18;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(settlement);
        quote.limit = 100e18;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = quote.setupDeadline;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        if (expectFailure) vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.acceptQuote(quote);
        creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
    }

    function testRemoteFloorTracksCurrentPrice() public {
        bytes32 creditId = _accept();
        assertEq(core.minimumRemoteRecoveryProceeds(creditId, 100e18), 450e18);
        oracle.setPrice(6e18);
        assertEq(core.minimumRemoteRecoveryProceeds(creditId, 100e18), 540e18);
    }

    function testRemoteFloorFailsClosedWhenPolicyDisabledOrSizeExceeded() public {
        bytes32 creditId = _accept();
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.minimumRemoteRecoveryProceeds(creditId, 1_001e18);
        oracle.setStale(true);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.minimumRemoteRecoveryProceeds(creditId, 100e18);
        oracle.setStale(false);
        core.disableRemoteSalePolicy(99, sourceAsset, address(settlement));
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.minimumRemoteRecoveryProceeds(creditId, 100e18);
    }

    function testQuoteRequiresActiveLivePolicy() public {
        oracle.setStale(true);
        _accept(true);
        oracle.setStale(false);
        oracle.setPrice(0);
        _accept(true);
        oracle.setPrice(5e18);
        core.disableRemoteSalePolicy(99, sourceAsset, address(settlement));
        _accept(true);
    }

    function testDisabledPolicyCanBeReconfigured() public {
        core.disableRemoteSalePolicy(99, sourceAsset, address(settlement));
        MockRemoteSaleOracle replacement = new MockRemoteSaleOracle();
        replacement.setPrice(6e18);
        core.setRemoteSalePolicy(
            99, sourceAsset, address(settlement), address(replacement), priceId, 18, 9_000, 1_000e18
        );
        bytes32 creditId = _accept();
        assertEq(core.minimumRemoteRecoveryProceeds(creditId, 100e18), 540e18);
    }

    function testDisabledPolicyCannotMakePendingCreditReady() public {
        bytes32 creditId = _accept();
        address borrower = vm.addr(borrowerKey);
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, keccak256("remote-lock"));
        core.proveCollateral(creditId, 99, hex"01", hex"02");
        CreditAccount account = new CreditAccount(creditId, borrower, address(core));
        core.disableRemoteSalePolicy(99, sourceAsset, address(settlement));
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.bindAccount(creditId, address(account));
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.CollateralProving));
    }

    function testRepaidPendingSeizureCanAuthorizeHeldReturnAfterConfirmation() public {
        RiskEngine risk = new RiskEngine(address(core));
        MockHealthSource healthSource = new MockHealthSource();
        core.setRisk(address(risk));
        core.setHealthSource(address(healthSource));
        bytes32 creditId = _accept();
        address borrower = vm.addr(borrowerKey);
        bytes32 lockId = keccak256("remote-lock");
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, lockId);
        core.proveCollateral(creditId, 99, hex"01", hex"02");
        CreditAccount account = new CreditAccount(creditId, borrower, address(core));
        vm.prank(borrower);
        core.bindAccount(creditId, address(account));

        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(0, 0, 1_000e18, 0, 10_000, 10_000, 0, 1_000e18, 0)
        );
        core.recordHealth(creditId);
        uint256 drawDeadline = block.timestamp + 1 hours;
        bytes32 drawDigest = keccak256(
            abi.encode(core.domain(), creditId, uint256(100e18), uint256(100e18), uint256(1), drawDeadline, core.creditRevision(creditId))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, drawDigest);
        core.draw(creditId, 100e18, 100e18, 1, drawDeadline, abi.encodePacked(r, s, v));

        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(0, 0, 50e18, 0, 10_000, 10_000, 0, 50e18, 0)
        );
        core.recordHealth(creditId);
        core.startLiquidation(creditId);
        core.setRecoveryKeeper(address(this), true);
        core.authorizeRemoteSeizure(creditId, 40e18, block.timestamp + 1 days);

        settlement.mint(borrower, 100e18);
        vm.startPrank(borrower);
        settlement.approve(address(core), 100e18);
        core.repay(creditId, 100e18);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.authorizeSourceRecoveryReturn(creditId, 40e18, block.timestamp + 1 days);
        vm.stopPrank();

        bytes32 seizureDigest = keccak256(abi.encode(
            core.remoteSeizureActionHash(creditId), lockId, address(0x789A), uint256(40e18), uint8(1)
        ));
        core.confirmRemoteSeizure(creditId, hex"01", abi.encode(seizureDigest));
        assertEq(core.creditDebt(creditId), 0);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.RecoveryPending));
        uint256 returnDeadline = block.timestamp + 1 days;
        vm.prank(borrower);
        bytes32 returnHash = core.authorizeSourceRecoveryReturn(creditId, 40e18, returnDeadline);
        assertEq(returnHash, core.sourceRecoveryReturnHash(creditId, 40e18, 2, returnDeadline));
        assertEq(core.remoteActionNonce(creditId), 2);
        assertTrue(core.remoteSeizureConfirmed(creditId));
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.cure(creditId);
        vm.warp(returnDeadline + 1);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.cure(creditId);
    }

    function testPendingRemoteReturnBlocksCureUntilConfirmed() public {
        RiskEngine risk = new RiskEngine(address(core));
        MockHealthSource healthSource = new MockHealthSource();
        core.setRisk(address(risk));
        core.setHealthSource(address(healthSource));
        core.setExitVerifier(keccak256("bundle"), address(new RemoteReturnExitVerifier()));
        bytes32 creditId = _accept();
        address borrower = vm.addr(borrowerKey);
        bytes32 lockId = keccak256("remote-lock");
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, lockId);
        core.proveCollateral(creditId, 99, hex"01", hex"02");
        CreditAccount account = new CreditAccount(creditId, borrower, address(core));
        vm.prank(borrower);
        core.bindAccount(creditId, address(account));
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(0, 0, 1_000e18, 0, 10_000, 10_000, 0, 1_000e18, 0)
        );
        core.recordHealth(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encode(core.domain(), creditId, uint256(100e18), uint256(100e18), uint256(1), deadline, core.creditRevision(creditId))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 100e18, 100e18, 1, deadline, abi.encodePacked(r, s, v));
        healthSource.setSnapshot(
            creditId, Types.HealthSnapshot(0, 0, 50e18, 0, 10_000, 10_000, 0, 50e18, 0)
        );
        core.recordHealth(creditId);
        core.startLiquidation(creditId);
        settlement.mint(borrower, 100e18);
        vm.startPrank(borrower);
        settlement.approve(address(core), 100e18);
        core.repay(creditId, 100e18);
        core.authorizeReturn(creditId, lockId, 20e18);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.cure(creditId);
        vm.stopPrank();
        bytes32 returnDigest = keccak256(abi.encode(
            core.remoteReturnActionHash(creditId), lockId, borrower, uint256(20e18), uint8(0)
        ));
        core.confirmRemoteReturn(creditId, hex"01", abi.encode(returnDigest));
        vm.prank(borrower);
        core.cure(creditId);
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.Ready));
    }
}
