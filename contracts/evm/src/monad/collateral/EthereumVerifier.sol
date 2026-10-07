// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LightClientVerifier} from "../../shared/collateral/LightClientVerifier.sol";
import {EthereumStateProof} from "./EthereumStateProof.sol";
import {EthereumExecutionHeaderProof} from "./EthereumExecutionHeaderProof.sol";
import {IConsensusLightClient} from "../../shared/collateral/IVerifier.sol";

interface IEthereumFinalizedBlockClient {
    function finalizedExecutionBlockHash(bytes calldata header) external view returns (bytes32);
    function verifyHistoricalFinality(bytes calldata header) external view returns (bool);
}

contract EthereumVerifier is LightClientVerifier {
    uint256 internal constant LOCK_COMMITMENTS_SLOT = 6;
    uint256 internal constant MAX_PROOF_BYTES = 96_000;
    address public sourceVault;
    bytes32 public sourceVaultCodeHash;
    address public sourceController;
    bytes32 public sourceControllerCodeHash;

    constructor(
        address lightClient_,
        address sourceVault_,
        bytes32 sourceVaultCodeHash_,
        address sourceController_,
        bytes32 sourceControllerCodeHash_
    ) LightClientVerifier(lightClient_) {
        if (!(
            lightClient_ == address(0)
            && sourceVault_ == address(0)
            && sourceVaultCodeHash_ == bytes32(0)
            && sourceController_ == address(0)
            && sourceControllerCodeHash_ == bytes32(0)
        )) {
            _initializeEthereumVerifier(
                lightClient_, sourceVault_, sourceVaultCodeHash_, sourceController_, sourceControllerCodeHash_
            );
        }
    }

    function initialize(
        address lightClient_,
        address sourceVault_,
        bytes32 sourceVaultCodeHash_,
        address sourceController_,
        bytes32 sourceControllerCodeHash_
    ) external initializer {
        _initializeLightClient(lightClient_);
        _initializeEthereumVerifier(lightClient_, sourceVault_, sourceVaultCodeHash_, sourceController_, sourceControllerCodeHash_);
    }

    function upgradeContractId() external pure override returns (bytes32) { return keccak256("termbook.EthereumVerifier.v1"); }

    function _initializeEthereumVerifier(
        address lightClient_,
        address sourceVault_,
        bytes32 sourceVaultCodeHash_,
        address sourceController_,
        bytes32 sourceControllerCodeHash_
    ) private {
        if (
            sourceChainId != 1 || sourceVault_ == address(0) || sourceVaultCodeHash_ == bytes32(0)
                || sourceController_ == address(0) || sourceController_ == sourceVault_
                || sourceControllerCodeHash_ == bytes32(0)
        ) {
            revert InvalidLightClient();
        }
        sourceVault = sourceVault_;
        sourceVaultCodeHash = sourceVaultCodeHash_;
        sourceController = sourceController_;
        sourceControllerCodeHash = sourceControllerCodeHash_;
    }

    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external
        view
        override
        returns (bool)
    {
        if (
            emitter != sourceVault || eventDigest == bytes32(0) || proof.length == 0 || proof.length > 160_000
        ) return false;
        bytes32 receiptsRoot;
        try this.verifiedHistoricalExecutionRoots(header) returns (bytes32, bytes32 root, uint256) {
            receiptsRoot = root;
        } catch {
            return false;
        }
        try this.verifyReceiptInRoot(receiptsRoot, proof, emitter, eventDigest, false) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function verifiedExecutionRoots(bytes calldata header)
        external
        view
        returns (bytes32 stateRoot, bytes32 receiptsRoot, uint256 timestamp)
    {
        if (msg.sender != address(this) || !this.verifyFinality(header)) revert InvalidLightClient();
        (bytes memory executionHeaderRlp,) = abi.decode(header, (bytes, bytes));
        bytes32 finalizedHash = IEthereumFinalizedBlockClient(lightClient).finalizedExecutionBlockHash(header);
        (stateRoot, receiptsRoot, timestamp) = EthereumExecutionHeaderProof.roots(executionHeaderRlp, finalizedHash);
        if (timestamp != IConsensusLightClient(lightClient).headerTimestamp(header)) revert InvalidLightClient();
    }

    function verifiedHistoricalExecutionRoots(bytes calldata header)
        external
        view
        returns (bytes32 stateRoot, bytes32 receiptsRoot, uint256 timestamp)
    {
        if (
            msg.sender != address(this) || lightClient.codehash != lightClientCodeHash
                || !IEthereumFinalizedBlockClient(lightClient).verifyHistoricalFinality(header)
        ) revert InvalidLightClient();
        (bytes memory executionHeaderRlp,) = abi.decode(header, (bytes, bytes));
        bytes32 finalizedHash = IEthereumFinalizedBlockClient(lightClient).finalizedExecutionBlockHash(header);
        (stateRoot, receiptsRoot, timestamp) = EthereumExecutionHeaderProof.roots(executionHeaderRlp, finalizedHash);
        if (timestamp != IConsensusLightClient(lightClient).headerTimestamp(header)) revert InvalidLightClient();
    }

    function verifyLock(bytes calldata header, bytes calldata proof, address vault, bytes32 lockDigest)
        external
        view
        override
        returns (bool)
    {
        if (vault != sourceVault || lockDigest == bytes32(0) || proof.length == 0 || proof.length > MAX_PROOF_BYTES) {
            return false;
        }
        bytes32 stateRoot;
        try this.verifiedExecutionRoots(header) returns (bytes32 root, bytes32, uint256) {
            stateRoot = root;
        } catch {
            return false;
        }
        if (stateRoot == bytes32(0)) return false;
        try this.verifyCommitmentInStateRoot(stateRoot, proof, vault, lockDigest) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function verifyCommitmentInStateRoot(bytes32 stateRoot, bytes calldata proof, address vault, bytes32 lockDigest)
        external
        view
        returns (bool)
    {
        if (msg.sender != address(this) || vault != sourceVault) return false;
        if (proof.length == 0 || proof.length > MAX_PROOF_BYTES) return false;
        // Proof nodes follow eth_getProof accountProof and storageProof ordering.
        (bytes32 lockId, bytes[] memory accountNodes, bytes[] memory storageNodes) =
            abi.decode(proof, (bytes32, bytes[], bytes[]));
        if (lockId == bytes32(0)) return false;
        bytes32 slot = keccak256(abi.encode(lockId, LOCK_COMMITMENTS_SLOT));
        return EthereumStateProof.verifyCommitment(
            stateRoot, vault, sourceVaultCodeHash, slot, lockDigest, accountNodes, storageNodes
        );
    }

    function verifyUnconsumedAction(
        bytes calldata header,
        bytes calldata proof,
        address controller,
        bytes32 actionHash,
        uint256 deadline
    ) external view returns (bool) {
        if (
            controller != sourceController || actionHash == bytes32(0) || deadline == 0 || proof.length == 0
                || proof.length > MAX_PROOF_BYTES
        ) return false;
        bytes32 stateRoot;
        uint256 timestamp;
        try this.verifiedExecutionRoots(header) returns (bytes32 root, bytes32, uint256 verifiedTimestamp) {
            stateRoot = root;
            timestamp = verifiedTimestamp;
        } catch {
            return false;
        }
        if (stateRoot == bytes32(0) || timestamp <= deadline) return false;
        try this.verifyUnconsumedInStateRoot(stateRoot, proof, controller, actionHash) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function verifyAppliedAction(
        bytes calldata header, bytes calldata proof, address vault, bytes32 actionHash
    ) external view returns (bool) {
        if (vault != sourceVault || actionHash == bytes32(0) || proof.length == 0 || proof.length > MAX_PROOF_BYTES) {
            return false;
        }
        bytes32 stateRoot;
        try this.verifiedExecutionRoots(header) returns (bytes32 root, bytes32, uint256) {
            stateRoot = root;
        } catch {
            return false;
        }
        if (stateRoot == bytes32(0)) return false;
        try this.verifyAppliedInStateRoot(stateRoot, proof, actionHash) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function verifyAppliedInStateRoot(bytes32 stateRoot, bytes calldata proof, bytes32 actionHash)
        external view returns (bool)
    {
        if (msg.sender != address(this) || proof.length == 0 || proof.length > MAX_PROOF_BYTES) return false;
        (bytes32 provenActionHash, bytes[] memory accountNodes, bytes[] memory storageNodes) =
            abi.decode(proof, (bytes32, bytes[], bytes[]));
        if (provenActionHash != actionHash) return false;
        bytes32 slot = keccak256(abi.encode(actionHash, uint256(0)));
        return EthereumStateProof.verifyCommitment(
            stateRoot, sourceController, sourceControllerCodeHash, slot, bytes32(uint256(1)),
            accountNodes, storageNodes
        );
    }

    function verifyUnconsumedInStateRoot(
        bytes32 stateRoot,
        bytes calldata proof,
        address controller,
        bytes32 actionHash
    ) external view returns (bool) {
        if (msg.sender != address(this) || controller != sourceController || proof.length > MAX_PROOF_BYTES) return false;
        (bytes32 provenActionHash, bytes[] memory accountNodes, bytes[] memory storageNodes) =
            abi.decode(proof, (bytes32, bytes[], bytes[]));
        if (provenActionHash != actionHash) return false;
        bytes32 slot = keccak256(abi.encode(actionHash, uint256(0)));
        return EthereumStateProof.verifyAbsence(
            stateRoot, controller, sourceControllerCodeHash, slot, accountNodes, storageNodes
        );
    }

}
