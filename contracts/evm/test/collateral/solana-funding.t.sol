// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {SettlementInbox} from "../../src/monad/routing/SettlementInbox.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";
import {MockERC20} from "../MockERC20.sol";
import {Types} from "../../src/shared/Types.sol";
import {VerifierRegistry} from "../../src/monad/collateral/VerifierRegistry.sol";

contract SolanaFundingHarness is TermbookCore {
    constructor(address governance_) TermbookCore(governance_, governance_, address(0)) {}

    function seedRecovery(bytes32 creditId, address borrower, address vault, uint256 sourceChain, uint256 seized) external {
        bytes32 genesis = bytes32(uint256(5));
        bytes32 program = bytes32(uint256(11));
        bytes32 recovery = bytes32(uint256(7));
        _credits[creditId].borrower = borrower;
        _credits[creditId].vault = vault;
        _credits[creditId].collateralAsset = solanaAlias(genesis, SOLANA_NATIVE_ASSET_ID);
        _credits[creditId].debt = 100e18;
        _credits[creditId].principal = 100e18;
        _credits[creditId].revision = 3;
        _credits[creditId].facility = Types.Facility.RecoveryPending;
        collateralSourceChainOf[creditId] = sourceChain;
        remoteCollateral[creditId] = true;
        solanaCollateral[creditId] = true;
        remoteSeizureConfirmed[creditId] = true;
        solanaSeizedAmount[creditId] = seized;
        remoteRecoveryVaultOf[creditId] = solanaAlias(genesis, recovery);
        solanaLockPdaOf[creditId] = bytes32(uint256(10));
        solanaIdentityOf[creditId] = SolanaIdentity(
            genesis, program, SOLANA_NATIVE_ASSET_ID, bytes32(uint256(4)), bytes32(uint256(6)), recovery, 1
        );
        recoveryKeepers[msg.sender] = true;
    }

    function seedVerifier(bytes32 creditId, address verifier) external {
        _credits[creditId].verifierVersion = 1;
        _credits[creditId].verifierCodeHash = verifier.codehash;
    }

    function clearDebt(bytes32 creditId) external {
        _credits[creditId].debt = 0;
    }
}

contract MockSolanaFundingFactory {
    mapping(bytes32 => address) public inboxOf;
    mapping(bytes32 => bytes32) public operationDigestOf;
    mapping(bytes32 => bool) public cancelled;
    mapping(bytes32 => uint256) public recoveryOperationDeadlineOf;
    function recoverySourceChain(bytes32) external pure returns (uint256) { return 99; }
    function cancelRecoveryOperation(bytes32 id) external { require(!cancelled[id]); cancelled[id] = true; }
    function setDeadline(bytes32 id, uint256 deadline) external { recoveryOperationDeadlineOf[id] = deadline; }

    function operationDigest(InboxFactory.Operation calldata operation) external pure returns (bytes32) {
        return keccak256(abi.encode(operation));
    }

    function register(bytes32 operationId, address inbox, bytes32 digest) external {
        inboxOf[operationId] = inbox;
        operationDigestOf[operationId] = digest;
    }
}

contract MockSolanaFundingWormhole {
    function chainId() external pure returns (uint16) { return 48; }
    function messageFee() external pure returns (uint256) { return 0; }
    function publishMessage(uint32, bytes memory, uint8) external payable returns (uint64) { return 1; }
}

contract MockSolanaFundingProofVerifier {
    bool public funded;
    bool public absent;
    bool public paid;
    bool public unpaid;
    uint256 public refundTotal;

    function setResults(bool funded_, bool absent_) external {
        funded = funded_;
        absent = absent_;
    }

    function setPayoutResults(bool paid_, bool unpaid_) external {
        paid = paid_;
        unpaid = unpaid_;
    }

    function setRefundTotal(uint256 amount) external {
        refundTotal = amount;
    }

    function admission() external pure returns (uint256, uint256, bytes32) {
        return (99, 1, keccak256("solana-bootstrap"));
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
        return keccak256("solana-bootstrap");
    }

    function verifySolanaFunding(
        bytes calldata header, bytes calldata proof, bytes32, bytes32, bytes32,
        bytes32, bytes32, bytes32, bytes32, uint256
    ) external view returns (bool) {
        return funded && header.length > 0 && proof.length > 0;
    }

    function verifySolanaFundingAbsence(
        bytes calldata header, bytes calldata proof, bytes32, bytes32, bytes32,
        bytes32, bytes32, bytes32, bytes32, uint256, uint256
    ) external view returns (bool) {
        return absent && header.length > 0 && proof.length > 0;
    }

    function verifySolanaPayout(
        bytes calldata header, bytes calldata proof, bytes32, bytes32, bytes32,
        bytes32, bytes32, bytes32, bytes32, uint256
    ) external view returns (bool) {
        return paid && header.length > 0 && proof.length > 0;
    }

    function verifySolanaPayoutAbsence(
        bytes calldata header, bytes calldata proof, bytes32, bytes32, bytes32,
        bytes32, bytes32, bytes32, bytes32, uint256, uint256
    ) external view returns (bool) {
        return unpaid && header.length > 0 && proof.length > 0;
    }

    function verifySolanaRefund(
        bytes calldata header, bytes calldata proof, bytes32, bytes32, bytes32,
        bytes32, bytes32, bytes32, uint256 cumulativeRefunded
    ) external view returns (bool) {
        return cumulativeRefunded == refundTotal && header.length > 0 && proof.length > 0;
    }
}

contract SolanaFundingTest is Test {
    uint256 private constant SOURCE_CHAIN = 99;
    bytes32 private constant CREDIT_ID = keccak256("solana-funded-credit");
    bytes32 private constant OPERATION_ID = keccak256("solana-sale-operation");
    uint256 private constant AMOUNT = 500_000_000;

    SolanaFundingHarness private core;
    MockSolanaFundingFactory private factory;
    MockERC20 private settlement;
    HouseVault private vault;
    address private borrower;
    address private routeSigner;
    address private riskSigner;

    function setUp() public {
        vm.warp(2 days);
        borrower = vm.addr(0xA11CE);
        routeSigner = vm.addr(0xBEEF);
        riskSigner = vm.addr(0xCAFE);
        core = new SolanaFundingHarness(address(this));
        core.configureSolanaWormhole(address(new MockSolanaFundingWormhole()));
        factory = new MockSolanaFundingFactory();
        settlement = new MockERC20();
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(settlement), address(core), address(this), address(0), address(0))));
        core.setSolanaMarket(SOURCE_CHAIN, bytes32(uint256(5)), bytes32(uint256(11)), keccak256("binary"));
        core.setRemoteSalePolicy(
            SOURCE_CHAIN,
            core.solanaAlias(bytes32(uint256(5)), core.SOLANA_NATIVE_ASSET_ID()),
            address(settlement),
            address(new MockRemoteSaleOracle()),
            keccak256("SOL/USD"),
            9,
            9_000,
            1_000_000_000
        );
        core.seedRecovery(CREDIT_ID, borrower, address(vault), SOURCE_CHAIN, 1_000_000_000);
        core.configureSolanaRecoveryFunding(address(factory), routeSigner, riskSigner);
    }

    function testAuthorizesRegisteredRiskApprovedFundingOnce() public {
        (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation) = _operation();
        bytes32 digest = factory.operationDigest(operation);
        factory.register(OPERATION_ID, funding.inbox, digest);
        bytes32 actionHash = core.solanaRecoveryFundHash(funding, digest, 1, 4);
        bytes memory routeSignature = _sign(0xBEEF, actionHash);
        bytes memory riskSignature = _sign(0xCAFE, actionHash);
        assertEq(core.authorizeSolanaRecoveryFund(funding, operation, routeSignature, riskSignature), actionHash);
        assertEq(core.solanaRecoveryAllocated(CREDIT_ID), AMOUNT);
        assertEq(core.remoteActionNonce(CREDIT_ID), 1);
        assertTrue(core.solanaRecoveryOperationFunded(OPERATION_ID));
        vm.expectRevert(TermbookCore.BadState.selector);
        core.authorizeSolanaRecoveryFund(funding, operation, routeSignature, riskSignature);
    }

    function testRejectsUnsignedDepositAndUnregisteredOperation() public {
        (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation) = _operation();
        bytes32 digest = factory.operationDigest(operation);
        bytes32 actionHash = core.solanaRecoveryFundHash(funding, digest, 1, 4);
        bytes memory routeSignature = _sign(0xBEEF, actionHash);
        bytes memory riskSignature = _sign(0xCAFE, actionHash);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.authorizeSolanaRecoveryFund(funding, operation, routeSignature, riskSignature);
        factory.register(OPERATION_ID, funding.inbox, digest);
        funding.depositPubkey = keccak256("different-deposit");
        vm.expectRevert(TermbookCore.BadSig.selector);
        core.authorizeSolanaRecoveryFund(funding, operation, routeSignature, riskSignature);
    }

    function testFinalizedFundingProofClearsPendingAction() public {
        MockSolanaFundingProofVerifier verifier = _configureVerifier();
        (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation) = _operation();
        bytes32 digest = factory.operationDigest(operation);
        factory.register(OPERATION_ID, funding.inbox, digest);
        bytes32 actionHash = core.solanaRecoveryFundHash(funding, digest, 1, 4);
        core.authorizeSolanaRecoveryFund(funding, operation, _sign(0xBEEF, actionHash), _sign(0xCAFE, actionHash));
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.confirmSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        verifier.setResults(true, false);
        core.confirmSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        assertEq(core.pendingSolanaFundingHash(CREDIT_ID), bytes32(0));
        assertEq(core.solanaRecoveryAllocated(CREDIT_ID), AMOUNT);
    }

    function testExpiredUnfundedProofReleasesAllocation() public {
        MockSolanaFundingProofVerifier verifier = _configureVerifier();
        (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation) = _operation();
        bytes32 digest = factory.operationDigest(operation);
        factory.register(OPERATION_ID, funding.inbox, digest);
        bytes32 actionHash = core.solanaRecoveryFundHash(funding, digest, 1, 4);
        core.authorizeSolanaRecoveryFund(funding, operation, _sign(0xBEEF, actionHash), _sign(0xCAFE, actionHash));
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        vm.warp(funding.deadline + 1);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.cancelExpiredSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        verifier.setResults(false, true);
        core.cancelExpiredSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        assertEq(core.pendingSolanaFundingHash(CREDIT_ID), bytes32(0));
        assertEq(core.solanaRecoveryAllocated(CREDIT_ID), 0);
        assertTrue(core.solanaRecoveryOperationFunded(OPERATION_ID));
    }

    function testRecoveryPayoutRequiresProofAndCannotBeOverwritten() public {
        MockSolanaFundingProofVerifier verifier = _configureVerifier();
        core.clearDebt(CREDIT_ID);
        uint256 deadline = block.timestamp + 1 days;
        vm.prank(borrower);
        bytes32 actionHash = core.authorizeSolanaRecoveryReturn(CREDIT_ID, AMOUNT, deadline);
        assertEq(core.pendingSolanaPayoutHash(CREDIT_ID), actionHash);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.authorizeSolanaRecoveryReturn(CREDIT_ID, AMOUNT, deadline);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.confirmSolanaRecoveryReturn(CREDIT_ID, hex"01", hex"02");
        verifier.setPayoutResults(true, false);
        core.confirmSolanaRecoveryReturn(CREDIT_ID, hex"01", hex"02");
        assertEq(core.pendingSolanaPayoutHash(CREDIT_ID), bytes32(0));
        assertEq(core.solanaRecoveryAllocated(CREDIT_ID), AMOUNT);
    }

    function testExpiredUnpaidProofReleasesAllocation() public {
        MockSolanaFundingProofVerifier verifier = _configureVerifier();
        core.clearDebt(CREDIT_ID);
        uint256 deadline = 3 days;
        vm.prank(borrower);
        bytes32 actionHash = core.authorizeSolanaRecoveryReturn(CREDIT_ID, AMOUNT, deadline);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredSolanaRecoveryReturn(CREDIT_ID, hex"01", hex"02");
        vm.warp(deadline + 1);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.cancelExpiredSolanaRecoveryReturn(CREDIT_ID, hex"01", hex"02");
        verifier.setPayoutResults(false, true);
        core.cancelExpiredSolanaRecoveryReturn(CREDIT_ID, hex"01", hex"02");
        assertEq(core.pendingSolanaPayoutHash(CREDIT_ID), bytes32(0));
        assertEq(core.solanaRecoveryAllocated(CREDIT_ID), 0);
        assertEq(core.remoteActionNonce(CREDIT_ID), 1);
        assertEq(core.solanaRecoveryReturnHash(CREDIT_ID, AMOUNT, 1, 4, deadline), actionHash);
    }

    function testSourceRefundRestoresAvailableRecoveryBalance() public {
        MockSolanaFundingProofVerifier verifier = _configureVerifier();
        (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation) = _operation();
        bytes32 digest = factory.operationDigest(operation);
        factory.register(OPERATION_ID, funding.inbox, digest);
        bytes32 actionHash = core.solanaRecoveryFundHash(funding, digest, 1, 4);
        core.authorizeSolanaRecoveryFund(funding, operation, _sign(0xBEEF, actionHash), _sign(0xCAFE, actionHash));
        verifier.setResults(true, false);
        core.confirmSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        core.clearDebt(CREDIT_ID);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.BadState.selector);
        core.authorizeSolanaRecoveryReturn(CREDIT_ID, 600_000_000, block.timestamp + 1 days);
        verifier.setRefundTotal(200_000_000);
        core.reconcileSolanaRecoveryRefund(CREDIT_ID, 200_000_000, hex"01", hex"02");
        assertEq(core.solanaRecoveryRefunded(CREDIT_ID), 200_000_000);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.reconcileSolanaRecoveryRefund(CREDIT_ID, 200_000_000, hex"01", hex"02");
        vm.prank(borrower);
        core.authorizeSolanaRecoveryReturn(CREDIT_ID, 600_000_000, block.timestamp + 1 days);
        assertEq(core.solanaRecoveryAllocated(CREDIT_ID), 1_100_000_000);
    }

    function testRefundBudgetRetiresOnlyConfirmedExpiredOperationsOnce() public {
        MockSolanaFundingProofVerifier verifier = _configureVerifier();
        (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation) = _operation();
        SettlementInbox inbox = new SettlementInbox(OPERATION_ID, address(vault), address(settlement), CREDIT_ID,
            operation.minOut, operation.maxReceived, borrower, operation.deadline);
        funding.inbox = address(inbox);
        factory.register(OPERATION_ID, funding.inbox, factory.operationDigest(operation));
        factory.setDeadline(OPERATION_ID, operation.deadline);
        bytes32 actionHash = core.solanaRecoveryFundHash(funding, factory.operationDigest(operation), 1, 4);
        core.authorizeSolanaRecoveryFund(funding, operation, _sign(0xBEEF, actionHash), _sign(0xCAFE, actionHash));
        verifier.setRefundTotal(AMOUNT);
        core.reconcileSolanaRecoveryRefund(CREDIT_ID, AMOUNT, hex"01", hex"02");
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        core.retireRefundedSolanaRecoveryOperation(CREDIT_ID, OPERATION_ID);
        verifier.setResults(true, false);
        core.confirmSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        core.retireRefundedSolanaRecoveryOperation(CREDIT_ID, OPERATION_ID);
        vm.warp(operation.deadline + 1);
        core.retireRefundedSolanaRecoveryOperation(CREDIT_ID, OPERATION_ID);
        assertTrue(factory.cancelled(OPERATION_ID));
        assertEq(core.solanaRecoveryRetiredRefunds(CREDIT_ID), AMOUNT);
        assertEq(core.solanaRecoveryAllocated(CREDIT_ID), AMOUNT);
        assertFalse(core.remoteRecoveryCleared(CREDIT_ID));
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        core.retireRefundedSolanaRecoveryOperation(CREDIT_ID, OPERATION_ID);
    }

    function testRefundBudgetCannotRetireAnInboxStillHoldingProceeds() public {
        MockSolanaFundingProofVerifier verifier = _configureVerifier();
        (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation) = _operation();
        SettlementInbox inbox = new SettlementInbox(OPERATION_ID, address(vault), address(settlement), CREDIT_ID,
            operation.minOut, operation.maxReceived, borrower, operation.deadline);
        funding.inbox = address(inbox);
        factory.register(OPERATION_ID, funding.inbox, factory.operationDigest(operation));
        factory.setDeadline(OPERATION_ID, operation.deadline);
        bytes32 actionHash = core.solanaRecoveryFundHash(funding, factory.operationDigest(operation), 1, 4);
        core.authorizeSolanaRecoveryFund(funding, operation, _sign(0xBEEF, actionHash), _sign(0xCAFE, actionHash));
        verifier.setResults(true, false);
        core.confirmSolanaRecoveryFund(CREDIT_ID, hex"01", hex"02");
        verifier.setRefundTotal(AMOUNT);
        core.reconcileSolanaRecoveryRefund(CREDIT_ID, AMOUNT, hex"01", hex"02");
        vm.warp(operation.deadline + 1);
        settlement.mint(address(inbox), 1);
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        core.retireRefundedSolanaRecoveryOperation(CREDIT_ID, OPERATION_ID);
        assertEq(core.solanaRecoveryRetiredRefunds(CREDIT_ID), 0);
    }

    function _configureVerifier() private returns (MockSolanaFundingProofVerifier verifier) {
        verifier = new MockSolanaFundingProofVerifier();
        VerifierRegistry registry = new VerifierRegistry(address(this));
        registry.setVerifier(SOURCE_CHAIN, address(verifier), 1, 1 days);
        core.setVerifierRegistry(address(registry));
        core.seedVerifier(CREDIT_ID, address(verifier));
    }

    function _operation()
        private view returns (TermbookCore.SolanaRecoveryFunding memory funding, InboxFactory.Operation memory operation)
    {
        funding = TermbookCore.SolanaRecoveryFunding({
            creditId: CREDIT_ID,
            operationId: OPERATION_ID,
            inbox: address(0x7777),
            depositPubkey: keccak256("aurora-sol-deposit"),
            amount: AMOUNT,
            quoteHash: keccak256("signed-quote"),
            deadline: block.timestamp + 1 days
        });
        operation = InboxFactory.Operation({
            operationId: OPERATION_ID,
            kind: 1,
            payer: address(this),
            sourceChain: SOURCE_CHAIN,
            sourceAsset: core.solanaAlias(bytes32(uint256(5)), core.SOLANA_NATIVE_ASSET_ID()),
            vault: address(vault),
            token: address(settlement),
            creditId: CREDIT_ID,
            maxAmountIn: AMOUNT,
            minOut: 3e18,
            maxReceived: 4e18,
            sourceRefund: core.remoteRecoveryVaultOf(CREDIT_ID),
            refundRecipient: borrower,
            deadline: block.timestamp + 2 days,
            routeId: keccak256("aurora-route"),
            routeVersion: bytes32(uint256(1)),
            lpRecipient: address(0),
            minShares: 0
        });
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
