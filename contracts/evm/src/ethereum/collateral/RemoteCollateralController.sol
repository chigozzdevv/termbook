// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

import {CollateralVault} from "../../shared/collateral/CollateralVault.sol";
import {RemoteAction} from "../../shared/collateral/RemoteAction.sol";
import {IVerifier, IVerifierAdmission} from "../../shared/collateral/IVerifier.sol";

interface ISourceRecoveryVault {
    function asset() external view returns (address);
    function controller() external view returns (address);
    function monadChain() external view returns (uint256);
    function recordSeizure(bytes32 creditId, uint256 amount) external;
}

contract RemoteCollateralController is ProxyInitializable {
    CollateralVault public vault;
    address public monadCore;
    uint256 public monadChain;
    address public recoveryVault;
    IVerifier public verifier;
    mapping(bytes32 => bool) public consumed;
    mapping(bytes32 => bytes32) public lastSeizureHash;
    address public governance;
    address public pauseGuardian;
    bool public paused;

    error Invalid();
    error Unauthorized();
    error Paused();
    event ActionExecuted(bytes32 indexed actionHash, bytes32 indexed creditId, uint8 kind, uint256 amount);
    event PauseGuardianSet(address indexed guardian);
    event PauseSet(bool paused);

    constructor(
        address asset,
        uint256 monadChain_,
        address monadCore_,
        address recoveryVault_,
        address verifier_,
        address governance_,
        address pauseGuardian_
    ) {
        if (!(
            asset == address(0)
            && monadChain_ == 0
            && monadCore_ == address(0)
            && recoveryVault_ == address(0)
            && verifier_ == address(0)
            && governance_ == address(0)
            && pauseGuardian_ == address(0)
        )) {
            _initializeRemoteCollateralController(
                asset, monadChain_, monadCore_, recoveryVault_, verifier_, governance_, pauseGuardian_
            );
        }
    }

    function initialize(
        address asset,
        uint256 monadChain_,
        address monadCore_,
        address recoveryVault_,
        address verifier_,
        address governance_,
        address pauseGuardian_
    ) external initializer {
        _initializeRemoteCollateralController(asset, monadChain_, monadCore_, recoveryVault_, verifier_, governance_, pauseGuardian_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.RemoteCollateralController.v1");
    }

    function _initializeRemoteCollateralController(
        address asset,
        uint256 monadChain_,
        address monadCore_,
        address recoveryVault_,
        address verifier_,
        address governance_,
        address pauseGuardian_
    ) private {
        if (
            asset.code.length == 0 || monadChain_ == 0 || monadChain_ == block.chainid || monadCore_ == address(0)
                || recoveryVault_.code.length == 0 || verifier_.code.length == 0 || governance_.code.length == 0
                || pauseGuardian_ == address(0)
        ) revert Invalid();
        if (
            ISourceRecoveryVault(recoveryVault_).asset() != asset
                || ISourceRecoveryVault(recoveryVault_).monadChain() != monadChain_
        ) revert Invalid();
        (uint256 verifierChain,,) = IVerifierAdmission(verifier_).admission();
        if (verifierChain != monadChain_) revert Invalid();
        monadChain = monadChain_;
        monadCore = monadCore_;
        recoveryVault = recoveryVault_;
        verifier = IVerifier(verifier_);
        governance = governance_;
        pauseGuardian = pauseGuardian_;
        vault = new CollateralVault(asset, block.chainid, address(this));
        vault.enableRemoteMode();
        paused = true;
        vault.setPaused(true);
    }

    function setPauseGuardian(address guardian) external {
        if (msg.sender != governance || guardian == address(0)) revert Unauthorized();
        pauseGuardian = guardian;
        emit PauseGuardianSet(guardian);
    }

    function setPaused(bool value) external {
        if (msg.sender != governance && (msg.sender != pauseGuardian || !value)) revert Unauthorized();
        if (!value && ISourceRecoveryVault(recoveryVault).controller() != address(this)) revert Invalid();
        paused = value;
        vault.setPaused(value);
        emit PauseSet(value);
    }

    function execute(RemoteAction.Authorization calldata action, bytes calldata header, bytes calldata proof) external {
        if (
            action.monadChain != monadChain || action.monadCore != monadCore || action.sourceChain != block.chainid
                || action.sourceVault != address(vault) || action.asset != vault.asset()
                || action.creditId == bytes32(0) || action.lockId == bytes32(0) || action.amount == 0
                || action.nonce == 0 || action.deadline < block.timestamp || action.kind > RemoteAction.TOPUP
        ) revert Invalid();
        if (paused) revert Paused();
        (
            bytes32 creditId,
            address owner,,,
            uint256 lockedAmount,
            address returnRecipient,,,
            bool exists,
            bool released,
            bool seized
        ) = vault.lockInfo(action.lockId);
        if (
            !exists || released || seized || creditId != action.creditId
                || (action.kind != RemoteAction.TOPUP && action.amount > lockedAmount)
                || (action.kind == RemoteAction.TOPUP && (action.recipient != owner || msg.sender != owner))
                || (action.kind == RemoteAction.SEIZE && action.recipient != recoveryVault)
                || (action.kind == RemoteAction.RELEASE && action.recipient != returnRecipient)
        ) revert Invalid();
        bytes32 actionHash = RemoteAction.hash(action);
        if (consumed[actionHash]) revert Invalid();
        bytes32 eventDigest = keccak256(abi.encode(action.creditId, actionHash, action.kind));
        if (!verifier.verifyEvent(header, proof, monadCore, eventDigest)) revert Unauthorized();
        consumed[actionHash] = true;
        if (action.kind == RemoteAction.RELEASE) {
            vault.releaseAuthorized(action.lockId, action.recipient, action.amount, action.nonce, actionHash);
        } else if (action.kind == RemoteAction.TOPUP) {
            vault.topUpAuthorized(action.lockId, action.recipient, action.amount, actionHash);
        } else {
            vault.seizeAuthorized(action.lockId, recoveryVault, action.amount, actionHash);
            ISourceRecoveryVault(recoveryVault).recordSeizure(action.creditId, action.amount);
            lastSeizureHash[action.creditId] = actionHash;
        }
        emit ActionExecuted(actionHash, action.creditId, action.kind, action.amount);
    }
}
