// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RemoteCollateralController} from "../../src/ethereum/collateral/RemoteCollateralController.sol";
import {RemoteAction} from "../../src/shared/collateral/RemoteAction.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {MockERC20} from "../MockERC20.sol";
import {SourceRecoveryVault} from "../../src/ethereum/collateral/SourceRecoveryVault.sol";
import {Vm} from "forge-std/Vm.sol";

contract MockActionVerifier {
    uint256 public immutable chain;
    bool public valid = true;

    constructor(uint256 chain_) {
        chain = chain_;
    }

    function admission() external view returns (uint256, uint256, bytes32) {
        return (chain, 1, keccak256("checkpoint"));
    }

    function setValid(bool value) external {
        valid = value;
    }

    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 digest)
        external
        view
        returns (bool)
    {
        (address provenEmitter, bytes32 provenDigest) = abi.decode(proof, (address, bytes32));
        return valid && abi.decode(header, (bool)) && emitter == provenEmitter && digest == provenDigest;
    }
}

contract RemoteControllerTest is Test {
    MockERC20 token;
    SourceRecoveryVault recovery;
    MockActionVerifier verifier;
    RemoteCollateralController controller;
    CollateralVault vault;
    address owner = address(0xBEEF);
    address guardian = address(0xABCD);
    address monadCore = address(0xCAFE);
    bytes32 creditId = keccak256("credit");
    bytes32 lockId = keccak256("lock");

    function setUp() public {
        token = new MockERC20();
        verifier = new MockActionVerifier(101);
        recovery = new SourceRecoveryVault(
            address(token), 101, address(0xFACA), address(verifier), address(this), address(this), address(0xBEEF)
        );
        controller = new RemoteCollateralController(
            address(token), 101, monadCore, address(recovery), address(verifier), address(this), guardian
        );
        recovery.setController(address(controller));
        controller.setPaused(false);
        vault = controller.vault();
        token.mint(owner, 1_000);
        vm.startPrank(owner);
        token.approve(address(vault), 1_000);
        vault.lockRemoteWithDeadline(lockId, creditId, owner, owner, 1_000, owner, block.timestamp + 1 days, 1);
        vm.stopPrank();
    }

    function testRemoteVaultRejectsUncommittedLock() public {
        assertEq(vault.lockCommitmentStorageSlot(lockId), keccak256(abi.encode(lockId, uint256(6))));
        vm.prank(owner);
        vm.expectRevert(CollateralVault.InvalidBinding.selector);
        vault.lock(keccak256("uncommitted"), creditId, owner, 1, owner);
    }

    function testNewControllerCannotAcceptLocksBeforeRecoveryBinding() public {
        SourceRecoveryVault unboundRecovery = new SourceRecoveryVault(
            address(token), 101, address(0xFACA), address(verifier), address(this), address(this), address(0xBEEF)
        );
        RemoteCollateralController unboundController = new RemoteCollateralController(
            address(token), 101, monadCore, address(unboundRecovery), address(verifier), address(this), guardian
        );
        assertTrue(unboundController.paused());
        CollateralVault unboundVault = unboundController.vault();
        assertTrue(unboundVault.paused());
        vm.prank(owner);
        vm.expectRevert(CollateralVault.InvalidBinding.selector);
        unboundVault.lockRemoteWithDeadline(
            keccak256("unbound-lock"), creditId, owner, owner, 1, owner, block.timestamp + 1 days, 1
        );
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        unboundController.setPaused(false);

        unboundRecovery.setController(address(unboundController));
        unboundController.setPaused(false);
        assertFalse(unboundController.paused());
        assertFalse(unboundController.vault().paused());
    }

    function _action(uint8 kind, address recipient) internal view returns (RemoteAction.Authorization memory action) {
        action = RemoteAction.Authorization({
            monadChain: 101,
            monadCore: monadCore,
            sourceChain: block.chainid,
            sourceVault: address(vault),
            creditId: creditId,
            lockId: lockId,
            asset: address(token),
            kind: kind,
            recipient: recipient,
            amount: 400,
            nonce: 1,
            deadline: block.timestamp + 1 days
        });
    }

    function _proof(RemoteAction.Authorization memory action) internal view returns (bytes memory) {
        return abi.encode(monadCore, keccak256(abi.encode(action.creditId, RemoteAction.hash(action), action.kind)));
    }

    function testTopUpRequiresOwnerFundingAndConsumesAuthorizationOnce() public {
        token.mint(owner, 400);
        vm.prank(owner); token.approve(address(vault), 400);
        RemoteAction.Authorization memory action = _action(RemoteAction.TOPUP, owner);
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        controller.execute(action, abi.encode(true), _proof(action));
        vm.prank(owner); controller.execute(action, abi.encode(true), _proof(action));
        assertEq(token.balanceOf(address(vault)), 1400);
        assertEq(token.balanceOf(owner), 0);
        assertTrue(controller.consumed(RemoteAction.hash(action)));
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        vm.prank(owner); controller.execute(action, abi.encode(true), _proof(action));
    }

    function testTopUpRejectsInvalidProofAndRollsBackCustody() public {
        token.mint(owner, 400);
        vm.prank(owner); token.approve(address(vault), 400);
        verifier.setValid(false);
        RemoteAction.Authorization memory action = _action(RemoteAction.TOPUP, owner);
        vm.expectRevert(RemoteCollateralController.Unauthorized.selector);
        vm.prank(owner); controller.execute(action, abi.encode(true), _proof(action));
        assertEq(token.balanceOf(owner), 400);
        assertEq(token.balanceOf(address(vault)), 1000);
        assertFalse(controller.consumed(RemoteAction.hash(action)));
    }

    function testFinalizedReturnMovesTokensToBoundOwner() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.RELEASE, owner);
        controller.execute(action, abi.encode(true), _proof(action));
        assertEq(token.balanceOf(owner), 400);
        assertEq(token.balanceOf(address(vault)), 600);
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        controller.execute(action, abi.encode(true), _proof(action));
    }

    function testRecoveryVaultMustTargetTheSameMonadChain() public {
        MockActionVerifier otherVerifier = new MockActionVerifier(143);
        SourceRecoveryVault wrongChain = new SourceRecoveryVault(
            address(token), 143, address(0xFACA), address(otherVerifier), address(this), address(this), address(0xBEEF)
        );
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        new RemoteCollateralController(
            address(token), 101, monadCore, address(wrongChain), address(verifier), address(this), guardian
        );
    }

    function testFinalizedSeizureMovesTokensOnlyToRecoveryVault() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.SEIZE, address(recovery));
        controller.execute(action, abi.encode(true), _proof(action));
        assertEq(token.balanceOf(address(recovery)), 400);
        assertEq(recovery.held(creditId), 400);
        assertEq(token.balanceOf(address(vault)), 600);
    }

    function testGuardianPauseStopsRemoteActionsAndNewLocks() public {
        vm.prank(guardian);
        controller.setPaused(true);
        assertTrue(controller.paused());
        assertTrue(vault.paused());

        RemoteAction.Authorization memory seizure = _action(RemoteAction.SEIZE, address(recovery));
        vm.expectRevert(RemoteCollateralController.Paused.selector);
        controller.execute(seizure, abi.encode(true), _proof(seizure));
        assertEq(recovery.held(creditId), 0);

        token.mint(owner, 100);
        vm.prank(owner);
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vault.lockRemoteWithDeadline(
            keccak256("second-lock"), creditId, owner, owner, 100, owner, block.timestamp + 1 days, 1
        );

        RemoteAction.Authorization memory release = _action(RemoteAction.RELEASE, owner);
        vm.expectRevert(RemoteCollateralController.Paused.selector);
        controller.execute(release, abi.encode(true), _proof(release));
        assertEq(token.balanceOf(owner), 100);

        vm.prank(guardian);
        vm.expectRevert(RemoteCollateralController.Unauthorized.selector);
        controller.setPaused(false);
        controller.setPaused(false);
        assertFalse(controller.paused());
        assertFalse(vault.paused());

        controller.execute(release, abi.encode(true), _proof(release));
        assertEq(token.balanceOf(owner), 500);
        controller.execute(seizure, abi.encode(true), _proof(seizure));
        assertEq(recovery.held(creditId), 400);
    }

    function testOnlyGovernanceCanReplaceGuardian() public {
        address nextGuardian = address(0xACDC);
        vm.prank(guardian);
        vm.expectRevert(RemoteCollateralController.Unauthorized.selector);
        controller.setPauseGuardian(nextGuardian);
        controller.setPauseGuardian(nextGuardian);
        vm.prank(guardian);
        vm.expectRevert(RemoteCollateralController.Unauthorized.selector);
        controller.setPaused(true);
        vm.prank(nextGuardian);
        controller.setPaused(true);
        assertTrue(controller.paused());
    }

    function testFinalizedDebtZeroReturnMovesHeldTokensToOriginalOwner() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.SEIZE, address(recovery));
        controller.execute(action, abi.encode(true), _proof(action));
        uint256 nonce = 2;
        uint256 deadline = action.deadline;
        bytes32 returnHash = recovery.returnHeldHash(creditId, owner, 400, nonce, deadline);
        bytes memory returnProof =
            abi.encode(monadCore, keccak256(abi.encode(creditId, returnHash, RemoteAction.RELEASE)));

        recovery.setFundingPaused(true);
        recovery.setPaused(true);
        vm.expectRevert(SourceRecoveryVault.Paused.selector);
        recovery.returnHeld(creditId, owner, 400, nonce, deadline, abi.encode(true), returnProof);
        recovery.setPaused(false);
        controller.setPaused(true);
        vm.expectRevert(SourceRecoveryVault.Paused.selector);
        recovery.returnHeld(creditId, owner, 400, nonce, deadline, abi.encode(true), returnProof);
        controller.setPaused(false);
        recovery.returnHeld(creditId, owner, 400, nonce, deadline, abi.encode(true), returnProof);
        assertEq(token.balanceOf(owner), 400);
        assertEq(recovery.held(creditId), 0);
        assertEq(recovery.totalHeld(), 0);

        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.returnHeld(creditId, owner, 400, nonce, deadline, abi.encode(true), returnProof);
    }

    function testHeldReturnRejectsRecipientForgeryAndUnfinalizedProof() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.SEIZE, address(recovery));
        controller.execute(action, abi.encode(true), _proof(action));
        uint256 deadline = action.deadline;
        bytes32 returnHash = recovery.returnHeldHash(creditId, owner, 400, 2, deadline);
        bytes memory returnProof =
            abi.encode(monadCore, keccak256(abi.encode(creditId, returnHash, RemoteAction.RELEASE)));

        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.returnHeld(creditId, address(0xBAD), 400, 2, deadline, abi.encode(true), returnProof);
        vm.expectRevert(SourceRecoveryVault.Unauthorized.selector);
        recovery.returnHeld(creditId, owner, 400, 2, deadline, abi.encode(false), returnProof);
        vm.warp(deadline + 1);
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.returnHeld(creditId, owner, 400, 2, deadline, abi.encode(true), returnProof);
        assertEq(recovery.held(creditId), 400);
        assertEq(token.balanceOf(owner), 0);
    }

    function testSeizureCannotChargeAnotherCreditLock() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.SEIZE, address(recovery));
        action.creditId = keccak256("other-credit");
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        controller.execute(action, abi.encode(true), _proof(action));
        assertEq(token.balanceOf(address(vault)), 1_000);
        assertEq(recovery.held(action.creditId), 0);
    }

    function testPartialSeizureEventsBindDistinctAuthorizations() public {
        RemoteAction.Authorization memory first = _action(RemoteAction.SEIZE, address(recovery));
        RemoteAction.Authorization memory second = _action(RemoteAction.SEIZE, address(recovery));
        second.nonce = 2;
        vm.recordLogs();
        controller.execute(first, abi.encode(true), _proof(first));
        controller.execute(second, abi.encode(true), _proof(second));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 eventId = keccak256("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)");
        uint256 count;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == eventId) {
                assertEq(logs[i].topics[1], count == 0 ? RemoteAction.hash(first) : RemoteAction.hash(second));
                count++;
            }
        }
        assertEq(count, 2);
        assertEq(recovery.held(creditId), 800);
    }

    function testForgedOrExpiredAuthorizationCannotMoveCollateral() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.SEIZE, address(recovery));
        bytes memory proof = _proof(action);
        action.recipient = owner;
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        controller.execute(action, abi.encode(true), proof);
        action.recipient = address(recovery);
        verifier.setValid(false);
        vm.expectRevert(RemoteCollateralController.Unauthorized.selector);
        controller.execute(action, abi.encode(true), proof);
        verifier.setValid(true);
        vm.warp(action.deadline + 1);
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        controller.execute(action, abi.encode(true), proof);
        assertEq(token.balanceOf(address(vault)), 1_000);
    }
}
