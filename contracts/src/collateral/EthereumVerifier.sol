// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LightClientVerifier} from "./LightClientVerifier.sol";
import {EthereumStateProof} from "./EthereumStateProof.sol";

interface IEthereumExecutionLightClient {
    function finalizedExecutionStateRoot(bytes calldata header) external view returns (bytes32);
}

contract EthereumVerifier is LightClientVerifier {
    uint256 internal constant LOCK_COMMITMENTS_SLOT = 6;
    uint256 internal constant MAX_PROOF_BYTES = 96_000;
    address public immutable sourceVault;
    bytes32 public immutable sourceVaultCodeHash;

    constructor(address lightClient_, address sourceVault_, bytes32 sourceVaultCodeHash_)
        LightClientVerifier(lightClient_)
    {
        if (sourceChainId != 1 || sourceVault_ == address(0) || sourceVaultCodeHash_ == bytes32(0)) {
            revert InvalidLightClient();
        }
        sourceVault = sourceVault_;
        sourceVaultCodeHash = sourceVaultCodeHash_;
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
        if (!this.verifyFinality(header)) return false;
        bytes32 stateRoot;
        try IEthereumExecutionLightClient(lightClient).finalizedExecutionStateRoot(header) returns (bytes32 root) {
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
}
