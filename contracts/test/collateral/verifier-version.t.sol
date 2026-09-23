// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/collateral/VerifierRegistry.sol";
import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {SourceRecoveryVault} from "../../src/collateral/SourceRecoveryVault.sol";
import {Types} from "../../src/shared/Types.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";
import {MockRecoveryOperationVerifier} from "../MockRecoveryOperationVerifier.sol";

contract MockVersionedVerifier {
    uint256 public immutable version;

    constructor(uint256 version_) {
        version = version_;
    }

    function admission() external view returns (uint256, uint256, bytes32) {
        return (99, version, keccak256("bootstrap"));
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

    function consensusVersion() external view returns (uint256) {
        return version;
    }

    function bootstrapHash() external pure returns (bytes32) {
        return keccak256("bootstrap");
    }
}

contract MockCommitmentVerifier is MockVersionedVerifier {
    address public expectedVault;
    bytes32 public expectedDigest;

    constructor() MockVersionedVerifier(1) {}

    function setExpected(address vault, bytes32 digest) external {
        expectedVault = vault;
        expectedDigest = digest;
    }

    function verifyLock(bytes calldata, bytes calldata, address vault, bytes32 digest) external view returns (bool) {
        return vault == expectedVault && digest == expectedDigest;
    }
}

contract VerifierVersionTest is Test {
    MockERC20 token;
    TermbookCore core;
    HouseVault vault;
    VerifierRegistry registry;
    MockRemoteSaleOracle oracle;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;
    address house;
    address borrower;
    address verifier;
    address public recoveryVault;
    address public monadCore;
    uint256 public monadChain;

    function setUp() public {
        token = new MockERC20();
        core = new TermbookCore(address(this), address(this), address(0));
        monadCore = address(core);
        monadChain = block.chainid;
        vault = new HouseVault(address(token), address(core), address(this), address(0), address(0));
        registry = new VerifierRegistry(address(this));
        oracle = new MockRemoteSaleOracle();
        core.setVerifierRegistry(address(registry));
        verifier = address(new MockVersionedVerifier(1));
        registry.setVerifier(99, verifier, 1, 1 days);
        core.setSourceCollateralVault(99, address(token), address(0x1234));
        core.setSourceRecoveryVault(99, address(token), address(0x5678));
        core.setRemoteSalePolicy(
            99, address(token), address(token), address(oracle), keccak256("remote-price"), 18, 9_000, 1_000
        );
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        token.mint(address(this), 100);
        token.approve(address(vault), 100);
        vault.deposit(address(this), 100);
    }

    function testRemoteCreditPinsVerifierVersion() public {
        bytes32 creditId = keccak256("credit");
        bytes32 intentId = keccak256("intent");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(vault),
            100,
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
            address(vault),
            100,
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
        vm.prank(borrower);
        core.setRemoteCollateral(creditId, 99, address(0x1234), address(token), 100, borrower, borrower);
        assertEq(core.remoteRecoveryVaultOf(creditId), address(0x5678));
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, keccak256("lock"));
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        assertEq(credit.verifierVersion, 1);

        registry.setVerifier(99, address(new MockVersionedVerifier(1)), 1, 1 days);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(creditId, 99, hex"", hex"");

        registry.setVerifier(99, address(new MockVersionedVerifier(2)), 2, 1 days);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(creditId, 99, hex"", hex"");
    }

    function testFullRemoteQuoteCanBindLockBeforeProof() public {
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("quoted-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = 99;
        quote.collateralVault = address(0x1234);
        quote.collateralAsset = address(token);
        quote.collateralAmount = 100;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(token);
        quote.limit = 100;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = block.timestamp + 1 days;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);

        vm.prank(borrower);
        core.acceptQuote(quote);
        bytes32 creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.CollateralLocking));
        core.setSourceRecoveryVault(99, address(token), address(0x9999));
        assertEq(core.remoteRecoveryVaultOf(creditId), address(0x5678));

        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, keccak256("quoted-lock"));
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.CollateralProving));
    }

    function testRemoteProofBindsPinnedRecoveryVaultAndMonadIdentity() public {
        MockCommitmentVerifier commitmentVerifier = new MockCommitmentVerifier();
        registry.setVerifier(99, address(commitmentVerifier), 1, 1 days);
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("commitment-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = 99;
        quote.collateralVault = address(0x1234);
        quote.collateralAsset = address(token);
        quote.collateralAmount = 100;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(token);
        quote.limit = 100;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = quote.setupDeadline;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        core.acceptQuote(quote);
        bytes32 creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        bytes32 lockId = keccak256("source-lock");
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, lockId);
        bytes32 digest = keccak256(abi.encode(
            creditId, lockId, borrower, borrower, quote.collateralVault, quote.collateralAsset,
            quote.collateralAmount, quote.sourceChain, quote.returnRecipient, address(0x5678),
            block.chainid, address(core)
        ));
        commitmentVerifier.setExpected(quote.collateralVault, digest);
        core.setSourceRecoveryVault(99, address(token), address(0x9999));
        core.proveCollateral(creditId, 99, hex"", hex"");
        assertTrue(core.collateralProven(creditId));
        assertEq(core.remoteRecoveryVaultOf(creditId), address(0x5678));
    }

    function testSourceLockCommitmentMatchesCoreProofDigest() public {
        MockCommitmentVerifier commitmentVerifier = new MockCommitmentVerifier();
        registry.setVerifier(99, address(commitmentVerifier), 1, 1 days);
        vm.chainId(99);
        MockRecoveryOperationVerifier recoveryVerifier = new MockRecoveryOperationVerifier(monadChain);
        SourceRecoveryVault recovery = new SourceRecoveryVault(
            address(token), monadChain, address(0xFACA), address(recoveryVerifier), address(this), borrower,
            address(this)
        );
        recovery.setController(address(this));
        recoveryVault = address(recovery);
        CollateralVault source = new CollateralVault(address(token), 99, address(this));
        vm.chainId(monadChain);
        core.setSourceCollateralVault(99, address(token), address(source));
        core.setSourceRecoveryVault(99, address(token), address(recovery));

        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("source-lock-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = 99;
        quote.collateralVault = address(source);
        quote.collateralAsset = address(token);
        quote.collateralAmount = 100;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(token);
        quote.limit = 100;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = quote.setupDeadline;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        core.acceptQuote(quote);
        bytes32 creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        bytes32 lockId = keccak256("source-lock");
        token.mint(borrower, 100);
        vm.prank(borrower);
        token.approve(address(source), 100);
        vm.chainId(99);
        vm.prank(borrower);
        source.lockRemoteWithDeadline(lockId, creditId, borrower, borrower, 100, borrower, quote.setupDeadline, 1);
        vm.chainId(monadChain);
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, lockId);
        commitmentVerifier.setExpected(address(source), source.lockCommitments(lockId));
        core.proveCollateral(creditId, 99, hex"", hex"");
        assertTrue(core.collateralProven(creditId));
    }

    function _freshReservedCredit(bool configureVerifier, bool configureRecovery)
        internal
        returns (TermbookCore target, bytes32 creditId)
    {
        target = new TermbookCore(address(this), address(this), address(0));
        HouseVault targetVault = new HouseVault(address(token), address(target), address(this), address(0), address(0));
        target.setSourceCollateralVault(99, address(token), address(0x1234));
        if (configureVerifier) target.setVerifierRegistry(address(registry));
        if (configureRecovery) target.setSourceRecoveryVault(99, address(token), address(0x5678));
        token.mint(address(this), 100);
        token.approve(address(targetVault), 100);
        targetVault.deposit(address(this), 100);

        bytes32 intentId = keccak256(abi.encode(address(target), "intent"));
        creditId = keccak256(abi.encode(address(target), "credit"));
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = target.quoteDigest(
            intentId, borrower, house, address(targetVault), 100, maturity, false, bundleId,
            setupDeadline, 0, 0, 1, setupDeadline, termsHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.prank(borrower);
        target.accept(
            creditId, intentId, borrower, house, address(targetVault), 100, maturity, false,
            bundleId, setupDeadline, 0, termsHash, 1, setupDeadline, abi.encodePacked(r, s, v)
        );
    }

    function testRemoteSetupRequiresVerifierAndRecoveryVault() public {
        (TermbookCore noVerifier, bytes32 first) = _freshReservedCredit(false, true);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        noVerifier.setRemoteCollateral(first, 99, address(0x1234), address(token), 100, borrower, borrower);

        (TermbookCore noRecovery, bytes32 second) = _freshReservedCredit(true, false);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        noRecovery.setRemoteCollateral(second, 99, address(0x1234), address(token), 100, borrower, borrower);
    }

    function testRemoteSetupRequiresLiveSalePolicy() public {
        (TermbookCore target, bytes32 creditId) = _freshReservedCredit(true, true);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        target.setRemoteCollateral(creditId, 99, address(0x1234), address(token), 100, borrower, borrower);
        TermbookCore.Credit memory credit = target.creditDetails(creditId);
        target.setRemoteSalePolicy(
            99, address(token), HouseVault(credit.vault).asset(), address(oracle),
            keccak256("remote-price"), 18, 9_000, 1_000
        );
        vm.prank(borrower);
        target.setRemoteCollateral(creditId, 99, address(0x1234), address(token), 100, borrower, borrower);
        assertTrue(target.remoteCollateral(creditId));
    }

    function testAbortedCreditCanBindLateRemoteLockWithoutSalePolicy() public {
        (TermbookCore target, bytes32 creditId) = _freshReservedCredit(true, true);
        vm.prank(borrower);
        target.abort(creditId);
        vm.prank(borrower);
        target.bindLateRemoteCollateral(
            creditId, keccak256("late-lock"), 99, address(0x1234), address(token), 100, borrower, borrower
        );
        assertTrue(target.remoteCollateral(creditId));
        assertEq(uint256(target.creditFacility(creditId)), uint256(Types.Facility.Aborted));
    }
}
