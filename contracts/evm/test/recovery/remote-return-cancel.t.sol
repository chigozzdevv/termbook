// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/monad/collateral/VerifierRegistry.sol";
import {AccountFactory} from "../../src/monad/credit/AccountFactory.sol";
import {MockExitVerifier} from "../integration/real-flow.t.sol";
import {Types} from "../../src/shared/Types.sol";

contract MockReturnCancelVerifier {
    bool public unconsumed;
    address public immutable sourceVault;
    address public immutable sourceController;
    uint256 public immutable chainId;

    constructor(address vault, address controller) {
        sourceVault = vault;
        sourceController = controller;
        chainId = block.chainid == 10143 ? 11155111 : 1;
    }

    function admission() external view returns (uint256, uint256, bytes32) {
        return (chainId, 1, keccak256("ethereum-bootstrap"));
    }

    function lightClient() external view returns (address) { return address(this); }
    function proofMaxAge() external pure returns (uint256) { return 1 days; }
    function consensusVersion() external pure returns (uint256) { return 1; }
    function bootstrapHash() external pure returns (bytes32) { return keccak256("ethereum-bootstrap"); }
    function verifyLock(bytes calldata, bytes calldata, address vault, bytes32 digest) external view returns (bool) {
        return vault == sourceVault && digest != bytes32(0);
    }

    function verifyAppliedAction(bytes calldata, bytes calldata proof, address vault, bytes32 digest) external view returns (bool) {
        return vault == sourceVault && abi.decode(proof, (bytes32)) == digest;
    }

    function setUnconsumed(bool value) external { unconsumed = value; }

    function verifyUnconsumedAction(
        bytes calldata, bytes calldata, address controller, bytes32 actionHash, uint256 deadline
    ) external view returns (bool) {
        return unconsumed && controller == sourceController && actionHash != bytes32(0) && deadline < block.timestamp;
    }
}

contract RemoteReturnCancelTest is CoreFixture {
    MockERC20 private settlement;
    TermbookCore private core;
    HouseVault private vault;
    MockReturnCancelVerifier private verifier;
    uint256 private houseKey = 0xBEEF;
    uint256 private borrowerKey = 0xCAFE;
    address private sourceAsset = address(0x1234);
    address private sourceVault = address(0x4567);
    address private sourceRecoveryVault = address(0x789A);
    address private sourceController = address(0xABCD);
    uint256 private sourceChain;

    function setUp() public virtual {
        sourceChain = block.chainid == 10143 ? 11155111 : 1;
        settlement = new MockERC20();
        core = _deployCore(address(this), address(this), address(0));
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(settlement), address(core), address(this), address(0), address(0))));
        verifier = new MockReturnCancelVerifier(sourceVault, sourceController);
        VerifierRegistry registry = new VerifierRegistry(address(this));
        core.setExitVerifier(keccak256("bundle"), address(new MockExitVerifier()));
        core.setVerifierRegistry(address(registry));
        registry.setVerifier(sourceChain, address(verifier), 1, 1 days);
        core.setSourceCollateralVault(sourceChain, sourceAsset, sourceVault);
        core.setSourceRecoveryVault(sourceChain, sourceAsset, sourceRecoveryVault);
        core.setRemoteSalePolicy(
            sourceChain, sourceAsset, address(settlement), address(new MockRemoteSaleOracle()),
            keccak256("ETH/settlement"), 18, 9_000, 1_000e18
        );
        settlement.mint(address(this), 1_000e18);
        settlement.approve(address(vault), 1_000e18);
        vault.deposit(address(this), 1_000e18);
    }

    function _preparedCredit(bool abortSetup) private returns (bytes32 creditId, bytes32 lockId) {
        address borrower = vm.addr(borrowerKey);
        address house = vm.addr(houseKey);
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("remote-return-cancel-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = sourceChain;
        quote.collateralVault = sourceVault;
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
        core.acceptQuote(quote);
        creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        lockId = keccak256("remote-lock");
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, lockId);
        core.proveCollateral(creditId, sourceChain, hex"01", hex"02");
        if (abortSetup) {
            vm.warp(quote.setupDeadline + 1);
            core.expireSetup(creditId);
        } else {
            AccountFactory accounts = new AccountFactory();
            vm.prank(borrower);
            address account = accounts.create(creditId, borrower, address(core));
            vm.prank(borrower);
            core.bindAccount(creditId, account);
            assertEq(uint256(core.creditDetails(creditId).facility), uint256(Types.Facility.Ready));
        }
    }

    function testExpiredReturnRequiresFinalizedNonexecutionProof() public {
        (bytes32 creditId, bytes32 lockId) = _preparedCredit(true);
        address borrower = vm.addr(borrowerKey);
        vm.prank(borrower);
        core.authorizeReturn(creditId, lockId, 20e18);
        bytes32 firstHash = core.remoteReturnActionHash(creditId);
        uint256 deadline = core.remoteReturnDeadline(creditId);
        assertEq(deadline, block.timestamp + 7 days);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        vm.warp(deadline + 1);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        verifier.setUnconsumed(true);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        assertEq(core.pendingRemoteReturn(creditId), 0);
        assertEq(core.remoteReturnActionHash(creditId), bytes32(0));
        assertEq(core.remoteReturnDeadline(creditId), 0);
        assertEq(core.creditDetails(creditId).collateralAmount, 100e18);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        vm.prank(borrower);
        core.authorizeReturn(creditId, lockId, 20e18);
        assertTrue(core.remoteReturnActionHash(creditId) != firstHash);
    }
    function testReadyWithdrawalRemovesBackingBeforeSourceExecution() public {
        (bytes32 id,) = _preparedCredit(false);
        vm.prank(vm.addr(borrowerKey)); core.withdrawCollateral(id, 70e18);
        bytes32 hash = core.remoteReturnActionHash(id);
        assertEq(core.creditDetails(id).collateralAmount, 30e18);
        assertEq(core.pendingRemoteReturn(id), 70e18);
        assertTrue(core.remoteReturnDeducted(id));
        vm.expectRevert(TermbookCore.Pending.selector);
        vm.prank(vm.addr(borrowerKey)); core.withdrawCollateral(id, 1e18);
        core.confirmRemoteReturn(id, hex"01", abi.encode(hash));
        assertEq(core.creditDetails(id).collateralAmount, 30e18);
        assertEq(core.collateralActionOutcome(hash), 1);
        assertFalse(core.remoteReturnDeducted(id));
        vm.expectRevert(TermbookCore.Pending.selector);
        core.confirmRemoteReturn(id, hex"01", abi.encode(hash));
    }

    function testWithdrawalExpiryRestoresOnlyAfterNonexecutionProof() public {
        (bytes32 id,) = _preparedCredit(false);
        vm.prank(vm.addr(borrowerKey)); core.withdrawCollateral(id, 70e18);
        bytes32 hash = core.remoteReturnActionHash(id);
        uint256 deadline = core.remoteReturnDeadline(id);
        vm.warp(deadline + 1);
        assertEq(core.creditDetails(id).collateralAmount, 30e18);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.cancelExpiredRemoteReturn(id, hex"01", hex"02");
        verifier.setUnconsumed(true);
        core.cancelExpiredRemoteReturn(id, hex"01", hex"02");
        assertEq(core.creditDetails(id).collateralAmount, 100e18);
        assertEq(core.collateralActionOutcome(hash), 2);
    }

    function testTopUpCountsOnlyProvedDeltaAndCannotReplayEarlierProof() public {
        (bytes32 id,) = _preparedCredit(false);
        address borrower = vm.addr(borrowerKey);
        vm.prank(borrower); core.withdrawCollateral(id, 70e18);
        core.confirmRemoteReturn(id, hex"01", abi.encode(core.remoteReturnActionHash(id)));
        vm.prank(borrower); core.addCollateral(id, 20e18, vm.getBlockTimestamp() + 1 hours);
        (,bytes32 hash,,) = core.pendingCollateralTopUp(id);
        assertEq(core.creditDetails(id).collateralAmount, 30e18);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.confirmCollateralTopUp(id, hex"01", abi.encode(bytes32(uint256(7))));
        core.confirmCollateralTopUp(id, hex"01", abi.encode(hash));
        assertEq(core.creditDetails(id).collateralAmount, 50e18);
        assertEq(core.collateralActionOutcome(hash), 1);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.confirmCollateralTopUp(id, hex"01", abi.encode(hash));
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(id, sourceChain, hex"01", hex"02");
    }

    function testTopUpLateConfirmationCannotOrphanFundsDuringClosure() public {
        (bytes32 id, bytes32 lockId) = _preparedCredit(false);
        address borrower = vm.addr(borrowerKey);
        vm.prank(borrower); core.addCollateral(id, 20e18, vm.getBlockTimestamp() + 1 hours);
        (,bytes32 hash,,) = core.pendingCollateralTopUp(id);
        vm.prank(borrower); core.startClosing(id);
        vm.expectRevert(TermbookCore.Pending.selector);
        vm.prank(borrower); core.authorizeReturn(id, lockId, 100e18);
        core.confirmCollateralTopUp(id, hex"01", abi.encode(hash));
        assertEq(core.creditDetails(id).collateralAmount, 120e18);
        vm.prank(borrower); core.authorizeReturn(id, lockId, 120e18);
    }

    function testUnfundedTopUpCanExpireWithoutAddingBacking() public {
        (bytes32 id,) = _preparedCredit(false);
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        vm.prank(vm.addr(borrowerKey)); core.addCollateral(id, 20e18, deadline);
        (,bytes32 hash,,) = core.pendingCollateralTopUp(id);
        vm.warp(deadline + 1); verifier.setUnconsumed(true);
        core.cancelExpiredCollateralTopUp(id, hex"01", hex"02");
        assertEq(core.creditDetails(id).collateralAmount, 100e18);
        assertEq(core.collateralActionOutcome(hash), 2);
    }

    function testPartialWithdrawalCanConfirmAfterClosingStarts() public {
        (bytes32 id,) = _preparedCredit(false);
        vm.prank(vm.addr(borrowerKey)); core.withdrawCollateral(id, 70e18);
        bytes32 hash = core.remoteReturnActionHash(id);
        vm.prank(vm.addr(borrowerKey)); core.startClosing(id);
        core.confirmRemoteReturn(id, hex"01", abi.encode(hash));
        assertEq(core.creditDetails(id).collateralAmount, 30e18);
    }

}

contract TestnetRemoteReturnCancelTest is RemoteReturnCancelTest {
    function setUp() public override {
        vm.chainId(10143);
        super.setUp();
    }
}
