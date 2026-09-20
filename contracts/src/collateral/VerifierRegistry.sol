// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifierAdmission, IConsensusLightClient} from "./IVerifier.sol";

contract VerifierRegistry {
    struct Verifier {
        address impl;
        uint256 version;
        bool active;
        uint256 maxAge;
        bytes32 codeHash;
    }

    mapping(uint256 => Verifier) public verifiers;
    mapping(uint256 => uint256) public consensusVersions;
    mapping(uint256 => bytes32) public bootstrapHashes;
    address public governance;

    event VerifierSet(uint256 indexed chainId, address impl, uint256 version);
    error Unauthorized();
    error Invalid();

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
    }

    function setVerifier(uint256 chainId, address impl, uint256 version, uint256 maxAge) external {
        if (msg.sender != governance || impl.code.length == 0 || version == 0 || maxAge == 0) revert Invalid();
        uint256 admittedChainId;
        uint256 admittedVersion;
        bytes32 admittedBootstrap;
        address lightClient;
        uint256 admittedMaxAge;
        try IVerifierAdmission(impl).admission() returns (uint256 chainId_, uint256 version_, bytes32 bootstrap_) {
            admittedChainId = chainId_;
            admittedVersion = version_;
            admittedBootstrap = bootstrap_;
        } catch {
            revert Invalid();
        }
        try IVerifierAdmission(impl).lightClient() returns (address lightClient_) {
            lightClient = lightClient_;
        } catch {
            revert Invalid();
        }
        try IVerifierAdmission(impl).proofMaxAge() returns (uint256 maxAge_) {
            admittedMaxAge = maxAge_;
        } catch {
            revert Invalid();
        }
        if (
            admittedChainId != chainId || admittedVersion != version || admittedBootstrap == bytes32(0)
                || lightClient.code.length == 0 || admittedMaxAge == 0 || maxAge > admittedMaxAge
        ) revert Invalid();
        try IConsensusLightClient(lightClient).chainId() returns (uint256 clientChainId) {
            if (clientChainId != admittedChainId) revert Invalid();
        } catch {
            revert Invalid();
        }
        try IConsensusLightClient(lightClient).consensusVersion() returns (uint256 clientVersion) {
            if (clientVersion != admittedVersion) revert Invalid();
        } catch {
            revert Invalid();
        }
        try IConsensusLightClient(lightClient).bootstrapHash() returns (bytes32 clientBootstrap) {
            if (clientBootstrap != admittedBootstrap) revert Invalid();
        } catch {
            revert Invalid();
        }
        verifiers[chainId] = Verifier(impl, version, true, maxAge, impl.codehash);
        consensusVersions[chainId] = admittedVersion;
        bootstrapHashes[chainId] = admittedBootstrap;
        emit VerifierSet(chainId, impl, version);
    }

    function disable(uint256 chainId) external {
        if (msg.sender != governance) revert Unauthorized();
        verifiers[chainId].active = false;
    }

    function getVerifier(uint256 chainId) external view returns (Verifier memory) {
        return verifiers[chainId];
    }
}
