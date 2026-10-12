// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

import {WormholeNetworks} from "../../shared/collateral/WormholeNetworks.sol";

import {CollateralVault} from "../../shared/collateral/CollateralVault.sol";
import {RemoteCollateralController} from "./RemoteCollateralController.sol";
import {IWormholeCore} from "../../shared/collateral/IWormholeCore.sol";
import {WormholeTermbookMessages as Messages} from "../../shared/collateral/WormholeTermbookMessages.sol";
import {SourceRecoveryVault} from "./SourceRecoveryVault.sol";
import {WormholeConfirmationPolicy as Confirmations, IWormholeConsistencyConfig} from "../../shared/collateral/WormholeConfirmationPolicy.sol";

contract WormholeEthereumPublisher is ProxyInitializable {
    CollateralVault public vault;
    RemoteCollateralController public controller;
    IWormholeCore public wormhole;
    bytes32 public vaultCodeHash;
    bytes32 public controllerCodeHash;
    bytes32 public wormholeCodeHash;
    mapping(bytes32 => bool) public published;
    mapping(bytes32 => uint64) public sequenceOf;
    mapping(bytes32 => uint256) public snapshotPublishedAt;
    uint16 public confirmationDepth;
    bytes32 public confirmationPolicyHash;
    bytes32 public consistencyConfigCodeHash;

    error Invalid();

    constructor(address vault_, address controller_, address wormhole_) {
        if (!(
            vault_ == address(0)
            && controller_ == address(0)
            && wormhole_ == address(0)
        )) {
            _initializeWormholeEthereumPublisher(vault_, controller_, wormhole_);
        }
    }

    function initialize(address vault_, address controller_, address wormhole_) external initializer {
        _initializeWormholeEthereumPublisher(vault_, controller_, wormhole_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.WormholeEthereumPublisher.v1");
    }

    function _initializeWormholeEthereumPublisher(address vault_, address controller_, address wormhole_) private {
        if (
            !WormholeNetworks.isEvmSource(block.chainid, WormholeNetworks.monadChain(block.chainid))
                || vault_.code.length == 0 || controller_.code.length == 0 || wormhole_.code.length == 0
                || IWormholeCore(wormhole_).chainId() != WormholeNetworks.evmWormholeChain(block.chainid)
                || address(RemoteCollateralController(controller_).vault()) != vault_
                || CollateralVault(vault_).core() != controller_
                || RemoteCollateralController(controller_).monadChain() != WormholeNetworks.monadChain(block.chainid)
        ) revert Invalid();
        vault = CollateralVault(vault_);
        controller = RemoteCollateralController(controller_);
        wormhole = IWormholeCore(wormhole_);
        vaultCodeHash = vault_.codehash;
        controllerCodeHash = controller_.codehash;
        wormholeCodeHash = wormhole_.codehash;
    }

    function publishLock(bytes32 lockId) external payable returns (uint64) {
        if (lockId == bytes32(0)) revert Invalid();
        bytes32 commitment = vault.lockCommitments(lockId);
        if (commitment == bytes32(0) || !vault.lockExists(lockId)) revert Invalid();
        return _publish(Messages.LOCK, commitment, 0);
    }

    function configureTestnetConfirmations(uint16 depth) external {
        if (block.chainid != 11155111 || msg.sender != controller.governance() || confirmationDepth != 0
            || depth < 5 || depth > 64 || Confirmations.SEPOLIA_CCL.code.length == 0) revert Invalid();
        confirmationDepth = depth;
        confirmationPolicyHash = Confirmations.digest(address(this), depth);
        consistencyConfigCodeHash = Confirmations.SEPOLIA_CCL.codehash;
        IWormholeConsistencyConfig(Confirmations.SEPOLIA_CCL).configure(Confirmations.configuration(depth));
        if (IWormholeConsistencyConfig(Confirmations.SEPOLIA_CCL).getConfiguration(address(this)) != Confirmations.configuration(depth)) revert Invalid();
    }

    function publishApplied(bytes32 actionHash) external payable returns (uint64) {
        if (actionHash == bytes32(0) || !controller.consumed(actionHash)) revert Invalid();
        return _publish(Messages.APPLIED, actionHash, 0);
    }

    function publishUnconsumed(bytes32 actionHash, uint256 deadline) external payable returns (uint64) {
        if (actionHash == bytes32(0) || deadline == 0 || block.timestamp <= deadline || controller.consumed(actionHash))
        revert Invalid();
        return _publish(Messages.UNCONSUMED, actionHash, deadline);
    }

    function publishRecoveryClearance(bytes32 creditId) external payable returns (uint64) {
        SourceRecoveryVault recovery = SourceRecoveryVault(controller.recoveryVault());
        bytes32 actionHash = controller.lastSeizureHash(creditId);
        if (creditId == bytes32(0) || actionHash == bytes32(0) || recovery.held(creditId) != 0
            || recovery.pendingCount(creditId) != 0 || recovery.controller() != address(controller)) revert Invalid();
        return _publish(Messages.RECOVERY_CLEAR, keccak256(abi.encode(creditId, address(recovery), actionHash)), 0);
    }

    function publishRecoveryRefund(bytes32 operationId) external payable returns (uint64) {
        SourceRecoveryVault recovery = SourceRecoveryVault(controller.recoveryVault());
        (bytes32 creditId, uint256 amount) = recovery.inFlight(operationId);
        if (creditId == bytes32(0) || !recovery.usedOperation(operationId)
            || amount != 0 || recovery.operationPending(operationId)) revert Invalid();
        return _publish(Messages.RECOVERY_REFUNDED, keccak256(abi.encode(
            creditId, address(recovery), operationId, recovery.deliveryDigest(operationId))), 0);
    }

    function _publish(uint8 kind, bytes32 digest, uint256 deadline) private returns (uint64) {
        bytes32 key = snapshotKey(kind, digest, deadline);
        if (
            (published[key] && block.timestamp < snapshotPublishedAt[key] + 1 hours)
                || address(vault).codehash != vaultCodeHash || address(controller).codehash != controllerCodeHash
                || address(wormhole).codehash != wormholeCodeHash || msg.value != wormhole.messageFee()
        ) revert Invalid();
        bytes memory payload = abi.encode(Messages.SNAPSHOT, kind, digest, deadline);
        uint8 consistency;
        if (confirmationDepth != 0) {
            if (block.chainid != 11155111 || Confirmations.SEPOLIA_CCL.codehash != consistencyConfigCodeHash
                || IWormholeConsistencyConfig(Confirmations.SEPOLIA_CCL).getConfiguration(address(this)) != Confirmations.configuration(confirmationDepth)) revert Invalid();
            payload = abi.encode(Messages.SNAPSHOT, kind, digest, deadline, confirmationPolicyHash);
            consistency = 203;
        }
        uint64 sequence = wormhole.publishMessage{value: msg.value}(0, payload, consistency);
        published[key] = true;
        sequenceOf[key] = sequence;
        snapshotPublishedAt[key] = block.timestamp;
        return sequence;
    }

    function snapshotKey(uint8 kind, bytes32 digest, uint256 deadline) public pure returns (bytes32) {
        return keccak256(abi.encode(kind, digest, deadline));
    }
}
