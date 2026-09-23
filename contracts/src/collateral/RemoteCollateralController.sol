// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CollateralVault} from "./CollateralVault.sol";
import {RemoteAction} from "./RemoteAction.sol";
import {IVerifier, IVerifierAdmission} from "./IVerifier.sol";

interface ISourceRecoveryVault {
    function asset() external view returns (address);
    function controller() external view returns (address);
    function monadChain() external view returns (uint256);
    function recordSeizure(bytes32 creditId, uint256 amount) external;
}

contract RemoteCollateralController {
    CollateralVault public immutable vault;
    address public immutable monadCore;
    uint256 public immutable monadChain;
    address public immutable recoveryVault;
    IVerifier public immutable verifier;
    mapping(bytes32 => bool) public consumed;

    error Invalid();
    error Unauthorized();
    event ActionExecuted(bytes32 indexed actionHash, bytes32 indexed creditId, uint8 kind, uint256 amount);

    constructor(address asset, uint256 monadChain_, address monadCore_, address recoveryVault_, address verifier_) {
        if (
            asset.code.length == 0 || monadChain_ == 0 || monadChain_ == block.chainid
                || monadCore_ == address(0) || recoveryVault_.code.length == 0 || verifier_.code.length == 0
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
        vault = new CollateralVault(asset, block.chainid, address(this));
    }

    function execute(RemoteAction.Authorization calldata action, bytes calldata header, bytes calldata proof) external {
        if (
            action.monadChain != monadChain || action.monadCore != monadCore
                || action.sourceChain != block.chainid || action.sourceVault != address(vault)
                || action.asset != vault.asset() || action.creditId == bytes32(0)
                || action.lockId == bytes32(0) || action.amount == 0 || action.nonce == 0
                || action.deadline < block.timestamp || action.kind > RemoteAction.SEIZE
        ) revert Invalid();
        if (action.kind == RemoteAction.SEIZE) {
            if (action.recipient != recoveryVault) revert Invalid();
        } else {
            (bytes32 creditId,,,,, address recipient,,, bool exists, bool released, bool seized) =
                vault.lockInfo(action.lockId);
            if (!exists || released || seized || creditId != action.creditId || recipient != action.recipient) {
                revert Invalid();
            }
        }
        bytes32 actionHash = RemoteAction.hash(action);
        if (consumed[actionHash]) revert Invalid();
        bytes32 eventDigest = keccak256(abi.encode(action.creditId, actionHash, action.kind));
        if (!verifier.verifyEvent(header, proof, monadCore, eventDigest)) revert Unauthorized();
        consumed[actionHash] = true;
        if (action.kind == RemoteAction.RELEASE) {
            vault.releaseAuthorized(action.lockId, action.recipient, action.amount, action.nonce, actionHash);
        } else {
            vault.seizeAuthorized(action.lockId, recoveryVault, action.amount, actionHash);
            ISourceRecoveryVault(recoveryVault).recordSeizure(action.creditId, action.amount);
        }
        emit ActionExecuted(actionHash, action.creditId, action.kind, action.amount);
    }
}
