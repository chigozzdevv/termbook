// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../ProxyInitializable.sol";

import {IVerifier, IVerifierAdmission, IConsensusLightClient} from "./IVerifier.sol";
import {EvmReceiptProof} from "./EvmReceiptProof.sol";

interface IExecutionReceiptsLightClient {
    function finalizedExecutionReceiptsRoot(bytes calldata header) external view returns (bytes32);
}

abstract contract LightClientVerifier is IVerifier, IVerifierAdmission, ProxyInitializable {
    address public lightClient;
    bytes32 public lightClientCodeHash;
    uint256 public sourceChainId;
    uint256 public consensusVersion;
    bytes32 public bootstrapHash;
    uint256 public proofMaxAge;

    error InvalidLightClient();

    constructor(address lightClient_) {
        if (lightClient_ != address(0)) _initializeLightClient(lightClient_);
    }

    function _initializeLightClient(address lightClient_) internal {
        if (lightClient_ == address(0) || lightClient_.code.length == 0) revert InvalidLightClient();
        lightClient = lightClient_;
        lightClientCodeHash = lightClient_.codehash;
        try IConsensusLightClient(lightClient_).chainId() returns (uint256 value) {
            sourceChainId = value;
        } catch {
            revert InvalidLightClient();
        }
        try IConsensusLightClient(lightClient_).consensusVersion() returns (uint256 value) {
            consensusVersion = value;
        } catch {
            revert InvalidLightClient();
        }
        try IConsensusLightClient(lightClient_).bootstrapHash() returns (bytes32 value) {
            bootstrapHash = value;
        } catch {
            revert InvalidLightClient();
        }
        try IConsensusLightClient(lightClient_).proofMaxAge() returns (uint256 value) {
            proofMaxAge = value;
        } catch {
            revert InvalidLightClient();
        }
        if (sourceChainId == 0 || consensusVersion == 0 || bootstrapHash == bytes32(0) || proofMaxAge == 0) {
            revert InvalidLightClient();
        }
    }

    function admission() external view returns (uint256 chainId, uint256 version, bytes32 bootstrap) {
        return (sourceChainId, consensusVersion, bootstrapHash);
    }

    function verifyFinality(bytes calldata header) external view returns (bool) {
        if (lightClient.codehash != lightClientCodeHash) return false;
        try IConsensusLightClient(lightClient).headerTimestamp(header) returns (uint256 timestamp) {
            if (timestamp == 0 || timestamp > block.timestamp || block.timestamp - timestamp > proofMaxAge) {
                return false;
            }
        } catch {
            return false;
        }
        try IConsensusLightClient(lightClient).verifyFinality(header) returns (bool verified) {
            return verified;
        } catch {
            return false;
        }
    }

    function verifyInclusion(bytes calldata proof, bytes32 root) external view returns (bool) {
        if (lightClient.codehash != lightClientCodeHash) return false;
        try IConsensusLightClient(lightClient).verifyInclusion(proof, root) returns (bool verified) {
            return verified;
        } catch {
            return false;
        }
    }

    function headerRoot(bytes calldata header) external view returns (bytes32) {
        if (lightClient.codehash != lightClientCodeHash) revert InvalidLightClient();
        return IConsensusLightClient(lightClient).headerRoot(header);
    }

    function proofLeaf(bytes calldata proof) external view returns (bytes32) {
        if (lightClient.codehash != lightClientCodeHash) revert InvalidLightClient();
        return IConsensusLightClient(lightClient).proofLeaf(proof);
    }

    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external
        view
        virtual
        returns (bool);

    function _verifyReceiptEvent(
        bytes calldata header,
        bytes calldata proof,
        address emitter,
        bytes32 eventDigest,
        bool authorization
    ) internal view returns (bool) {
        if (emitter == address(0) || eventDigest == bytes32(0) || proof.length == 0 || proof.length > 160_000) {
            return false;
        }
        if (!this.verifyFinality(header)) return false;
        bytes32 receiptsRoot;
        try IExecutionReceiptsLightClient(lightClient).finalizedExecutionReceiptsRoot(header) returns (bytes32 root) {
            receiptsRoot = root;
        } catch {
            return false;
        }
        if (receiptsRoot == bytes32(0)) return false;
        try this.verifyReceiptInRoot(receiptsRoot, proof, emitter, eventDigest, authorization) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function verifyReceiptInRoot(
        bytes32 receiptsRoot,
        bytes calldata proof,
        address emitter,
        bytes32 eventDigest,
        bool authorization
    ) external view returns (bool) {
        if (msg.sender != address(this)) return false;
        return EvmReceiptProof.verify(receiptsRoot, proof, emitter, eventDigest, authorization);
    }

    function verifyLock(bytes calldata header, bytes calldata proof, address vault, bytes32 lockDigest)
        external
        view
        virtual
        returns (bool)
    {
        if (vault == address(0) || lockDigest == bytes32(0)) return false;
        if (lightClient.codehash != lightClientCodeHash) return false;
        try IConsensusLightClient(lightClient).headerTimestamp(header) returns (uint256 timestamp) {
            if (timestamp == 0 || timestamp > block.timestamp || block.timestamp - timestamp > proofMaxAge) {
                return false;
            }
        } catch {
            return false;
        }
        try IConsensusLightClient(lightClient).verifyFinality(header) returns (bool final_) {
            if (!final_) return false;
        } catch {
            return false;
        }
        try IConsensusLightClient(lightClient).verifyLock(header, proof, vault, lockDigest) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }
}
