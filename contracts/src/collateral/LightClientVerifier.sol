// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier, IVerifierAdmission, IConsensusLightClient} from "./IVerifier.sol";

abstract contract LightClientVerifier is IVerifier, IVerifierAdmission {
    address public immutable lightClient;
    uint256 public immutable sourceChainId;
    uint256 public immutable consensusVersion;
    bytes32 public immutable bootstrapHash;
    uint256 public immutable proofMaxAge;

    error InvalidLightClient();

    constructor(address lightClient_) {
        if (lightClient_ == address(0) || lightClient_.code.length == 0) revert InvalidLightClient();
        lightClient = lightClient_;
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
        try IConsensusLightClient(lightClient).headerTimestamp(header) returns (uint256 timestamp) {
            if (timestamp == 0 || timestamp > block.timestamp || block.timestamp - timestamp > proofMaxAge) return false;
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
        try IConsensusLightClient(lightClient).verifyInclusion(proof, root) returns (bool verified) {
            return verified;
        } catch {
            return false;
        }
    }

    function headerRoot(bytes calldata header) external view returns (bytes32) {
        return IConsensusLightClient(lightClient).headerRoot(header);
    }

    function proofLeaf(bytes calldata proof) external view returns (bytes32) {
        return IConsensusLightClient(lightClient).proofLeaf(proof);
    }

    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external view returns (bool)
    {
        if (emitter == address(0) || eventDigest == bytes32(0)) return false;
        try IConsensusLightClient(lightClient).headerTimestamp(header) returns (uint256 timestamp) {
            if (timestamp == 0 || timestamp > block.timestamp || block.timestamp - timestamp > proofMaxAge) return false;
        } catch {
            return false;
        }
        try IConsensusLightClient(lightClient).verifyFinality(header) returns (bool final_) {
            if (!final_) return false;
        } catch {
            return false;
        }
        try IConsensusLightClient(lightClient).verifyEvent(header, proof, emitter, eventDigest) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function verifyLock(bytes calldata header, bytes calldata proof, address vault, bytes32 lockDigest)
        external view returns (bool)
    {
        if (vault == address(0) || lockDigest == bytes32(0)) return false;
        try IConsensusLightClient(lightClient).headerTimestamp(header) returns (uint256 timestamp) {
            if (timestamp == 0 || timestamp > block.timestamp || block.timestamp - timestamp > proofMaxAge) return false;
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
