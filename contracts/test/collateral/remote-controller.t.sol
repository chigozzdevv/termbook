// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RemoteCollateralController} from "../../src/collateral/RemoteCollateralController.sol";
import {RemoteAction} from "../../src/collateral/RemoteAction.sol";
import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {MockERC20} from "../MockERC20.sol";
import {SourceRecoveryVault} from "../../src/collateral/SourceRecoveryVault.sol";
import {Vm} from "forge-std/Vm.sol";

contract MockActionVerifier {
    uint256 public immutable chain;
    bool public valid = true;

    constructor(uint256 chain_) { chain = chain_; }

    function admission() external view returns (uint256, uint256, bytes32) {
        return (chain, 1, keccak256("checkpoint"));
    }

    function setValid(bool value) external { valid = value; }

    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 digest)
        external view returns (bool)
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
    address monadCore = address(0xCAFE);
    bytes32 creditId = keccak256("credit");
    bytes32 lockId = keccak256("lock");

    function setUp() public {
        token = new MockERC20();
        recovery = new SourceRecoveryVault(address(token), 101, address(this), address(this));
        verifier = new MockActionVerifier(101);
        controller = new RemoteCollateralController(address(token), 101, monadCore, address(recovery), address(verifier));
        recovery.setController(address(controller));
        vault = controller.vault();
        token.mint(owner, 1_000);
        vm.startPrank(owner);
        token.approve(address(vault), 1_000);
        vault.lock(lockId, creditId, owner, 1_000, owner);
        vm.stopPrank();
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

    function testFinalizedReturnMovesTokensToBoundOwner() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.RELEASE, owner);
        controller.execute(action, abi.encode(true), _proof(action));
        assertEq(token.balanceOf(owner), 400);
        assertEq(token.balanceOf(address(vault)), 600);
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        controller.execute(action, abi.encode(true), _proof(action));
    }

    function testFinalizedSeizureMovesTokensOnlyToRecoveryVault() public {
        RemoteAction.Authorization memory action = _action(RemoteAction.SEIZE, address(recovery));
        controller.execute(action, abi.encode(true), _proof(action));
        assertEq(token.balanceOf(address(recovery)), 400);
        assertEq(recovery.held(creditId), 400);
        assertEq(token.balanceOf(address(vault)), 600);
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
