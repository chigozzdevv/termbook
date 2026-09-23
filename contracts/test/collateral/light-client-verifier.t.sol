// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MonadVerifier} from "../../src/collateral/MonadVerifier.sol";
import {EthereumVerifier} from "../../src/collateral/EthereumVerifier.sol";
import {VerifierRegistry} from "../../src/collateral/VerifierRegistry.sol";
import {IConsensusLightClient} from "../../src/collateral/IVerifier.sol";

contract MockConsensusLightClient is IConsensusLightClient {
    uint256 public immutable chainId;
    uint256 public immutable consensusVersion;
    bytes32 public immutable bootstrapHash;
    uint256 public immutable proofMaxAge;
    bool public finality;
    bool public inclusion;

    constructor(uint256 chainId_, uint256 version_, bytes32 bootstrap_, uint256 maxAge_) {
        chainId = chainId_;
        consensusVersion = version_;
        bootstrapHash = bootstrap_;
        proofMaxAge = maxAge_;
    }

    function setResults(bool finality_, bool inclusion_) external {
        finality = finality_;
        inclusion = inclusion_;
    }

    function headerTimestamp(bytes calldata header) external pure returns (uint256 timestamp) {
        (timestamp,) = abi.decode(header, (uint256, bytes32));
    }

    function verifyFinality(bytes calldata) external view returns (bool) {
        return finality;
    }

    function headerRoot(bytes calldata header) external pure returns (bytes32 root) {
        (, root) = abi.decode(header, (uint256, bytes32));
    }

    function finalizedExecutionStateRoot(bytes calldata header) external pure returns (bytes32 root) {
        (, root) = abi.decode(header, (uint256, bytes32));
    }

    function verifyInclusion(bytes calldata, bytes32) external view returns (bool) {
        return inclusion;
    }

    function verifyEvent(bytes calldata, bytes calldata proof, address emitter, bytes32 digest)
        external
        view
        returns (bool)
    {
        (address provenEmitter, bytes32 provenDigest) = abi.decode(proof, (address, bytes32));
        return inclusion && emitter == provenEmitter && digest == provenDigest;
    }

    function verifyLock(bytes calldata, bytes calldata proof, address vault, bytes32 digest)
        external
        view
        returns (bool)
    {
        (address provenVault, bytes32 provenDigest) = abi.decode(proof, (address, bytes32));
        return inclusion && vault == provenVault && digest == provenDigest;
    }

    function proofLeaf(bytes calldata proof) external pure returns (bytes32 leaf) {
        leaf = abi.decode(proof, (bytes32));
    }
}

contract LegacyFinalityVerifier {}

contract LightClientVerifierTest is Test {
    function testFinalityAndInclusionDelegateToChainClient() public {
        MockConsensusLightClient client = new MockConsensusLightClient(99, 7, keccak256("bootstrap"), 1 days);
        MonadVerifier verifier = new MonadVerifier(address(client));
        MockConsensusLightClient ethereumClient =
            new MockConsensusLightClient(1, 7, keccak256("ethereum-bootstrap"), 1 days);
        EthereumVerifier ethereumVerifier =
            new EthereumVerifier(address(ethereumClient), address(0xBEEF), keccak256("source-vault-runtime"));
        bytes32 root = keccak256("root");
        bytes memory header = abi.encode(block.timestamp, root);
        bytes memory proof = abi.encode(root);
        client.setResults(true, true);
        ethereumClient.setResults(true, true);

        assertTrue(verifier.verifyFinality(header));
        assertTrue(verifier.verifyInclusion(proof, root));
        assertEq(verifier.headerRoot(header), root);
        assertEq(verifier.proofLeaf(proof), root);
        assertTrue(ethereumVerifier.verifyFinality(header));
        bytes32 digest = keccak256("lock");
        bytes memory lockProof = abi.encode(address(0xBEEF), digest);
        assertTrue(verifier.verifyLock(header, lockProof, address(0xBEEF), digest));
        assertFalse(verifier.verifyLock(header, lockProof, address(0xCAFE), digest));

        client.setResults(false, false);
        assertFalse(verifier.verifyFinality(header));
        assertFalse(verifier.verifyInclusion(proof, root));
    }

    function testStaleHeaderFailsClosed() public {
        MockConsensusLightClient client = new MockConsensusLightClient(99, 7, keccak256("bootstrap"), 1 days);
        MonadVerifier verifier = new MonadVerifier(address(client));
        client.setResults(true, true);
        vm.warp(2 days);
        assertFalse(verifier.verifyFinality(abi.encode(uint256(1), keccak256("root"))));
    }

    function testRegistryRejectsVerifierWithoutAdmissionMetadata() public {
        VerifierRegistry registry = new VerifierRegistry(address(this));
        address legacy = address(new LegacyFinalityVerifier());
        vm.expectRevert(VerifierRegistry.Invalid.selector);
        registry.setVerifier(99, legacy, 1, 1 days);
    }

    function testRegistryAgeMatchesVerifierEnforcement() public {
        VerifierRegistry registry = new VerifierRegistry(address(this));
        MockConsensusLightClient client = new MockConsensusLightClient(99, 7, keccak256("bootstrap"), 1 days);
        MonadVerifier verifier = new MonadVerifier(address(client));
        vm.expectRevert(VerifierRegistry.Invalid.selector);
        registry.setVerifier(99, address(verifier), 7, 1 hours);
        registry.setVerifier(99, address(verifier), 7, 1 days);
    }
}
