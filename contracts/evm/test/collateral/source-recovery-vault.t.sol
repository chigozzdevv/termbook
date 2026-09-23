// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SourceRecoveryVault} from "../../src/ethereum/collateral/SourceRecoveryVault.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockRecoveryOperationVerifier} from "../MockRecoveryOperationVerifier.sol";

contract RecoveryControllerCaller {
    bool public paused;

    function record(SourceRecoveryVault vault, bytes32 creditId, uint256 amount) external {
        vault.recordSeizure(creditId, amount);
    }

    function setPaused(bool value) external { paused = value; }
}

contract SourceRecoveryVaultTest is Test {
    MockERC20 token;
    SourceRecoveryVault recovery;
    RecoveryControllerCaller controller;
    MockRecoveryOperationVerifier verifier;
    uint256 signerKey = 0xBEEF;
    uint256 riskKey = 0xCAFE;
    bytes32 creditId = keccak256("credit");
    bytes32 operationId = keccak256("operation");
    address deposit = address(0xD00D);
    address factory = address(0xFACA);

    function setUp() public {
        token = new MockERC20();
        verifier = new MockRecoveryOperationVerifier(101);
        recovery = new SourceRecoveryVault(
            address(token), 101, factory, address(verifier), address(this), vm.addr(signerKey), vm.addr(riskKey)
        );
        controller = new RecoveryControllerCaller();
        recovery.setController(address(controller));
        token.mint(address(recovery), 500);
        controller.record(recovery, creditId, 500);
    }

    function _signature(uint256 key, bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _funding() internal view returns (SourceRecoveryVault.Funding memory funding) {
        funding = SourceRecoveryVault.Funding({
            creditId: creditId,
            operationId: operationId,
            inbox: address(0xABCD),
            depositAddress: deposit,
            amount: 300,
            quoteHash: keccak256("signed quote"),
            nonce: 1,
            deadline: block.timestamp + 1 days
        });
    }

    function _operation(SourceRecoveryVault.Funding memory funding)
        internal
        view
        returns (InboxFactory.Operation memory op)
    {
        op = InboxFactory.Operation({
            operationId: funding.operationId,
            kind: 1,
            payer: address(0xBEEF),
            sourceChain: block.chainid,
            sourceAsset: address(token),
            vault: address(0xAAAA),
            token: address(0xBBBB),
            creditId: funding.creditId,
            maxAmountIn: funding.amount,
            minOut: 250,
            maxReceived: 400,
            sourceRefund: address(recovery),
            refundRecipient: address(0xCCCC),
            deadline: funding.deadline,
            routeId: keccak256("route"),
            routeVersion: bytes32(uint256(1)),
            lpRecipient: address(0),
            minShares: 0
        });
    }

    function _admit(InboxFactory.Operation memory op, address inbox) internal {
        verifier.setExpected(factory, keccak256(abi.encode(op.operationId, recovery.operationDigest(op), inbox)));
    }

    function _fund(SourceRecoveryVault.Funding memory funding, InboxFactory.Operation memory op) internal {
        bytes32 digest = recovery.fundingDigest(funding);
        recovery.fund(
            funding, op, hex"01", hex"01", _signature(signerKey, digest), _signature(riskKey, digest)
        );
    }

    function testFundAndAttributePartialSourceRefund() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        InboxFactory.Operation memory op = _operation(funding);
        _admit(op, funding.inbox);
        _fund(funding, op);
        assertEq(token.balanceOf(deposit), 300);
        assertEq(recovery.held(creditId), 200);
        (, uint256 inFlightBefore) = recovery.inFlight(operationId);
        assertEq(inFlightBefore, 300);
        bytes32 refundTx = keccak256("refund tx");
        token.mint(address(recovery), 100);
        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = recovery.refundDigest(operationId, refundTx, 100, 1, deadline);
        recovery.recordSourceRefund(
            operationId, refundTx, 100, 1, deadline, _signature(signerKey, digest), _signature(riskKey, digest)
        );
        assertEq(recovery.held(creditId), 300);
        (, uint256 inFlightAfter) = recovery.inFlight(operationId);
        assertEq(inFlightAfter, 200);
    }

    function testSignatureBindsDestinationAndPreventReplay() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        InboxFactory.Operation memory op = _operation(funding);
        _admit(op, funding.inbox);
        bytes memory signature = _signature(signerKey, recovery.fundingDigest(funding));
        bytes memory riskSignature = _signature(riskKey, recovery.fundingDigest(funding));
        funding.depositAddress = address(0xBAD);
        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.fund(funding, op, hex"01", hex"01", signature, riskSignature);
        funding.depositAddress = deposit;
        recovery.fund(funding, op, hex"01", hex"01", signature, riskSignature);
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.fund(funding, op, hex"01", hex"01", signature, riskSignature);
    }

    function testFundingRequiresFinalizedOperationAndIndependentApproval() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        InboxFactory.Operation memory op = _operation(funding);
        bytes32 digest = recovery.fundingDigest(funding);
        bytes memory routeSignature = _signature(signerKey, digest);
        bytes memory riskSignature = _signature(riskKey, digest);
        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, riskSignature);
        _admit(op, funding.inbox);
        verifier.setValid(false);
        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, riskSignature);
        verifier.setValid(true);
        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, routeSignature);
        _fund(funding, op);
        assertEq(token.balanceOf(deposit), 300);
    }

    function testFundingRejectsOperationWithDifferentCollateralOrAmount() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        InboxFactory.Operation memory op = _operation(funding);
        _admit(op, funding.inbox);
        bytes32 digest = recovery.fundingDigest(funding);
        bytes memory routeSignature = _signature(signerKey, digest);
        bytes memory riskSignature = _signature(riskKey, digest);
        op.maxAmountIn--;
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, riskSignature);
        op = _operation(funding);
        op.sourceAsset = address(0xBAD);
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, riskSignature);
        assertEq(recovery.held(creditId), 500);
    }

    function testGuardianCanPauseFundingButOnlyGovernanceCanResume() public {
        address guardian = address(0xA11CE);
        recovery.setPauseGuardian(guardian);
        vm.prank(guardian);
        recovery.setFundingPaused(true);
        SourceRecoveryVault.Funding memory funding = _funding();
        InboxFactory.Operation memory op = _operation(funding);
        _admit(op, funding.inbox);
        bytes32 digest = recovery.fundingDigest(funding);
        bytes memory routeSignature = _signature(signerKey, digest);
        bytes memory riskSignature = _signature(riskKey, digest);
        vm.expectRevert(SourceRecoveryVault.Paused.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, riskSignature);
        assertEq(recovery.held(creditId), 500);
        vm.prank(guardian);
        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.setFundingPaused(false);
        recovery.setFundingPaused(false);
        _fund(funding, op);
        assertEq(token.balanceOf(deposit), 300);
    }

    function testEmergencyPauseAndControllerPauseBlockFunding() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        InboxFactory.Operation memory op = _operation(funding);
        _admit(op, funding.inbox);
        bytes32 digest = recovery.fundingDigest(funding);
        bytes memory routeSignature = _signature(signerKey, digest);
        bytes memory riskSignature = _signature(riskKey, digest);
        address guardian = address(0xA11CE);
        recovery.setPauseGuardian(guardian);
        vm.prank(guardian);
        recovery.setPaused(true);
        vm.expectRevert(SourceRecoveryVault.Paused.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, riskSignature);
        vm.prank(guardian);
        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.setPaused(false);
        recovery.setPaused(false);
        controller.setPaused(true);
        vm.expectRevert(SourceRecoveryVault.Paused.selector);
        recovery.fund(funding, op, hex"01", hex"01", routeSignature, riskSignature);
        controller.setPaused(false);
        _fund(funding, op);
        assertEq(token.balanceOf(deposit), 300);
    }

    function testRefundNeedsIndependentAttestationAndUniqueTransaction() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        InboxFactory.Operation memory op = _operation(funding);
        _admit(op, funding.inbox);
        _fund(funding, op);
        bytes32 refundTx = keccak256("refund tx");
        token.mint(address(recovery), 100);
        recovery.setPaused(true);
        controller.setPaused(true);
        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = recovery.refundDigest(operationId, refundTx, 60, 1, deadline);
        bytes memory routeSignature = _signature(signerKey, digest);
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.recordSourceRefund(operationId, refundTx, 60, 1, deadline, routeSignature, routeSignature);
        recovery.recordSourceRefund(
            operationId, refundTx, 60, 1, deadline, routeSignature, _signature(riskKey, digest)
        );
        digest = recovery.refundDigest(operationId, refundTx, 40, 2, deadline);
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.recordSourceRefund(
            operationId, refundTx, 40, 2, deadline, _signature(signerKey, digest), _signature(riskKey, digest)
        );
        assertEq(recovery.held(creditId), 260);
        assertEq(recovery.usedRefundTxHash(refundTx), true);
    }
}
