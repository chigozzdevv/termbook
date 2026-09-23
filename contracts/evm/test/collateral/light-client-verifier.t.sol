// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MonadVerifier} from "../../src/ethereum/collateral/MonadVerifier.sol";
import {EthereumVerifier} from "../../src/monad/collateral/EthereumVerifier.sol";
import {LightClientVerifier} from "../../src/shared/collateral/LightClientVerifier.sol";
import {VerifierRegistry} from "../../src/monad/collateral/VerifierRegistry.sol";
import {IConsensusLightClient} from "../../src/shared/collateral/IVerifier.sol";
import {EthereumHeaderFixture} from "./EthereumHeaderFixture.sol";

contract MockConsensusLightClient is IConsensusLightClient {
    uint256 public immutable chainId;
    uint256 public immutable consensusVersion;
    bytes32 public immutable bootstrapHash;
    uint256 public immutable proofMaxAge;
    bool public finality;
    bool public inclusion;
    bytes32 public finalizedHashOverride;
    uint256 public timestampOverride;

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

    function setFinalizedHashOverride(bytes32 value) external {
        finalizedHashOverride = value;
    }

    function setTimestampOverride(uint256 value) external {
        timestampOverride = value;
    }

    function headerTimestamp(bytes calldata header) external view returns (uint256 timestamp) {
        if (timestampOverride != 0) return timestampOverride;
        if (chainId == 1) {
            (,, timestamp) = EthereumHeaderFixture.roots(header);
            return timestamp;
        }
        (timestamp,) = abi.decode(header, (uint256, bytes32));
    }

    function finalizedExecutionBlockHash(bytes calldata header) external view returns (bytes32) {
        return finalizedHashOverride == bytes32(0) ? keccak256(EthereumHeaderFixture.raw(header)) : finalizedHashOverride;
    }

    function verifyFinality(bytes calldata) external view returns (bool) {
        return finality;
    }

    function verifyHistoricalFinality(bytes calldata) external view returns (bool) {
        return finality;
    }

    function headerRoot(bytes calldata header) external pure returns (bytes32 root) {
        (, root) = abi.decode(header, (uint256, bytes32));
    }

    function finalizedExecutionStateRoot(bytes calldata header) external pure returns (bytes32 root) {
        (, root) = abi.decode(header, (uint256, bytes32));
    }

    function finalizedExecutionReceiptsRoot(bytes calldata header) external pure returns (bytes32 root) {
        (,, root) = abi.decode(header, (uint256, bytes32, bytes32));
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
            new EthereumVerifier(
                address(ethereumClient), address(0xBEEF), keccak256("source-vault-runtime"),
                address(0xC0DE), keccak256("source-controller-runtime")
            );
        bytes32 root = keccak256("root");
        bytes memory header = abi.encode(block.timestamp, root);
        bytes memory proof = abi.encode(root);
        client.setResults(true, true);
        ethereumClient.setResults(true, true);

        assertTrue(verifier.verifyFinality(header));
        assertTrue(verifier.verifyInclusion(proof, root));
        assertEq(verifier.headerRoot(header), root);
        assertEq(verifier.proofLeaf(proof), root);
        assertTrue(ethereumVerifier.verifyFinality(EthereumHeaderFixture.header(block.timestamp, root, root)));
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

    function testRuntimeCodeChangeFailsClosed() public {
        MockConsensusLightClient client = new MockConsensusLightClient(99, 7, keccak256("bootstrap"), 1 days);
        MonadVerifier verifier = new MonadVerifier(address(client));
        bytes32 root = keccak256("root");
        bytes memory header = abi.encode(block.timestamp, root);
        bytes memory proof = abi.encode(root);
        client.setResults(true, true);
        assertTrue(verifier.verifyFinality(header));
        assertEq(verifier.lightClientCodeHash(), address(client).codehash);

        vm.etch(address(client), hex"00");
        assertFalse(verifier.verifyFinality(header));
        assertFalse(verifier.verifyInclusion(proof, root));
        assertFalse(verifier.verifyLock(header, abi.encode(address(0xBEEF), root), address(0xBEEF), root));
        vm.expectRevert(LightClientVerifier.InvalidLightClient.selector);
        verifier.headerRoot(header);
        vm.expectRevert(LightClientVerifier.InvalidLightClient.selector);
        verifier.proofLeaf(proof);
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
