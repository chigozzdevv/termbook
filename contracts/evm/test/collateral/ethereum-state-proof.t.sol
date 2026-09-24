// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EthereumVerifier} from "../../src/monad/collateral/EthereumVerifier.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {MockConsensusLightClient} from "./light-client-verifier.t.sol";
import {EthereumHeaderFixture} from "./EthereumHeaderFixture.sol";
import {MockERC20} from "../MockERC20.sol";

contract EthereumStateProofTest is Test {
    MockConsensusLightClient client;
    EthereumVerifier verifier;
    CollateralVault vault;
    bytes32 lockId = keccak256("lock-id");
    bytes32 digest = keccak256("lock-commitment");

    function setUp() public {
        vm.warp(2 days);
        client = new MockConsensusLightClient(1, 1, keccak256("checkpoint"), 1 days);
        vault = new CollateralVault(address(new MockERC20()), 1, address(this));
        verifier = new EthereumVerifier(
            address(client), address(vault), address(vault).codehash, address(this), address(this).codehash
        );
        client.setResults(true, true);
    }

    function testVerifiesAccountAndStorageTrieFromFinalizedExecutionRoot() public {
        (bytes memory header, bytes memory proof) = _proof(address(vault), lockId, digest, false);
        assertTrue(verifier.verifyLock(header, proof, address(vault), digest));
        assertFalse(verifier.verifyLock(header, proof, address(0xBAD), digest));
        assertFalse(verifier.verifyLock(header, proof, address(vault), keccak256("other")));
        assertFalse(
            verifier.verifyLock(
                EthereumHeaderFixture.header(block.timestamp, keccak256("other-root"), bytes32(uint256(1))),
                proof,
                address(vault),
                digest
            )
        );
    }

    function testVerifiesHashedBranchStorageProof() public {
        (bytes memory header, bytes memory proof) = _proof(address(vault), lockId, digest, true);
        assertTrue(verifier.verifyLock(header, proof, address(vault), digest));
    }

    function testRejectsHeaderNotBoundToFinalizedBlockHashOrTimestamp() public {
        (bytes memory header, bytes memory proof) = _proof(address(vault), lockId, digest, false);
        client.setFinalizedHashOverride(keccak256("different-finalized-block"));
        assertFalse(verifier.verifyLock(header, proof, address(vault), digest));
        client.setFinalizedHashOverride(bytes32(0));
        client.setTimestampOverride(block.timestamp - 1);
        assertFalse(verifier.verifyLock(header, proof, address(vault), digest));
    }

    function testVerifiesCanonicalStorageWordWithLeadingZeroBytes() public {
        bytes32 shortDigest = bytes32(uint256(0x1234));
        (bytes memory header, bytes memory proof) = _proof(address(vault), lockId, shortDigest, false);
        assertTrue(verifier.verifyLock(header, proof, address(vault), shortDigest));
    }

    function testRejectsDifferentSourceVaultRuntimeCode() public {
        (bytes memory header, bytes memory proof) =
            _proofWithCodeHash(address(vault), lockId, digest, false, keccak256("different-runtime"));
        assertFalse(verifier.verifyLock(header, proof, address(vault), digest));
    }

    function testRejectsWrongSlotExtraNodesAndStaleFinality() public {
        (bytes memory header, bytes memory proof) = _proof(address(vault), lockId, digest, false);
        (bytes32 provenLockId, bytes[] memory accountNodes, bytes[] memory storageNodes) =
            abi.decode(proof, (bytes32, bytes[], bytes[]));
        assertEq(provenLockId, lockId);
        assertFalse(
            verifier.verifyLock(
                header, abi.encode(keccak256("wrong-lock"), accountNodes, storageNodes), address(vault), digest
            )
        );
        bytes[] memory extraNodes = new bytes[](2);
        extraNodes[0] = storageNodes[0];
        extraNodes[1] = storageNodes[0];
        assertFalse(verifier.verifyLock(header, abi.encode(lockId, accountNodes, extraNodes), address(vault), digest));
        client.setResults(false, true);
        assertFalse(verifier.verifyLock(header, proof, address(vault), digest));
        client.setResults(true, true);
        (bytes32 stateRoot,,) = EthereumHeaderFixture.roots(header);
        assertFalse(
            verifier.verifyLock(
                EthereumHeaderFixture.header(block.timestamp - 1 days - 1, stateRoot, bytes32(uint256(1))),
                proof,
                address(vault),
                digest
            )
        );
    }

    function testRejectsInvalidRlpAndNonEthereumClient() public {
        (bytes memory header, bytes memory proof) = _proof(address(vault), lockId, digest, false);
        (, bytes[] memory accountNodes, bytes[] memory storageNodes) = abi.decode(proof, (bytes32, bytes[], bytes[]));
        accountNodes[0][0] = bytes1(0xc1);
        bytes memory malformed = abi.encode(lockId, accountNodes, storageNodes);
        assertFalse(verifier.verifyLock(header, malformed, address(vault), digest));
        assertFalse(
            verifier.verifyLock(
                EthereumHeaderFixture.header(block.timestamp, keccak256(accountNodes[0]), bytes32(uint256(1))),
                malformed,
                address(vault),
                digest
            )
        );
        assertFalse(verifier.verifyLock(header, hex"123456", address(vault), digest));
        MockConsensusLightClient wrongChain = new MockConsensusLightClient(11155111, 1, keccak256("checkpoint"), 1 days);
        vm.expectRevert();
        new EthereumVerifier(address(wrongChain), address(vault), address(vault).codehash, address(this), address(this).codehash);
        vm.expectRevert();
        new EthereumVerifier(address(client), address(0), address(vault).codehash, address(this), address(this).codehash);
        vm.expectRevert();
        new EthereumVerifier(address(client), address(vault), bytes32(0), address(this), address(this).codehash);
        vm.expectRevert();
        new EthereumVerifier(address(client), address(vault), address(vault).codehash, address(0), address(this).codehash);
        vm.expectRevert();
        new EthereumVerifier(address(client), address(vault), address(vault).codehash, address(this), bytes32(0));
    }

    function testMappingSlotMatchesDeployedVaultLayout() public {
        assertEq(vault.lockCommitmentStorageSlot(lockId), keccak256(abi.encode(lockId, uint256(6))));
    }

    function testCancelsOnlyAfterFinalizedControllerStorageAbsence() public view {
        bytes32 actionHash = keccak256("seizure-action");
        (bytes memory header, bytes memory proof) = _absenceProof(actionHash, false, false, address(this).codehash);
        assertTrue(verifier.verifyUnconsumedAction(header, proof, address(this), actionHash, block.timestamp - 1));
        assertFalse(verifier.verifyUnconsumedAction(header, proof, address(this), actionHash, block.timestamp));
        assertFalse(verifier.verifyUnconsumedAction(header, proof, address(vault), actionHash, block.timestamp - 1));
        assertFalse(verifier.verifyUnconsumedAction(header, proof, address(this), keccak256("other"), block.timestamp - 1));
        (bytes32 provenActionHash, bytes[] memory accountNodes, bytes[] memory storageNodes) =
            abi.decode(proof, (bytes32, bytes[], bytes[]));
        assertEq(provenActionHash, actionHash);
        bytes[] memory extraNodes = new bytes[](1);
        extraNodes[0] = accountNodes[0];
        assertFalse(verifier.verifyUnconsumedAction(
            header, abi.encode(actionHash, accountNodes, extraNodes), address(this), actionHash, block.timestamp - 1
        ));
        assertEq(storageNodes.length, 0);
    }

    function testVerifiesMissingLeafAndRejectsOccupiedSlotOrCodeChange() public view {
        bytes32 actionHash = keccak256("seizure-action");
        (bytes memory missingHeader, bytes memory missingProof) =
            _absenceProof(actionHash, false, true, address(this).codehash);
        assertTrue(verifier.verifyUnconsumedAction(
            missingHeader, missingProof, address(this), actionHash, block.timestamp - 1
        ));
        (bytes memory occupiedHeader, bytes memory occupiedProof) =
            _absenceProof(actionHash, true, true, address(this).codehash);
        assertFalse(verifier.verifyUnconsumedAction(
            occupiedHeader, occupiedProof, address(this), actionHash, block.timestamp - 1
        ));
        (bytes memory wrongCodeHeader, bytes memory wrongCodeProof) =
            _absenceProof(actionHash, false, false, keccak256("wrong-controller"));
        assertFalse(verifier.verifyUnconsumedAction(
            wrongCodeHeader, wrongCodeProof, address(this), actionHash, block.timestamp - 1
        ));
    }

    function testConfirmsAppliedActionOnlyFromFinalizedControllerState() public view {
        bytes32 actionHash = keccak256("seizure-action");
        (bytes memory header, bytes memory proof) = _absenceProof(actionHash, true, true, address(this).codehash);
        assertTrue(verifier.verifyAppliedAction(header, proof, address(vault), actionHash));
        assertFalse(verifier.verifyAppliedAction(header, proof, address(0xBAD), actionHash));
        assertFalse(verifier.verifyAppliedAction(header, proof, address(vault), keccak256("other")));
        assertFalse(verifier.verifyUnconsumedAction(header, proof, address(this), actionHash, block.timestamp - 1));
        (bytes memory missingHeader, bytes memory missingProof) =
            _absenceProof(actionHash, false, false, address(this).codehash);
        assertFalse(verifier.verifyAppliedAction(missingHeader, missingProof, address(vault), actionHash));
        (bytes memory wrongCodeHeader, bytes memory wrongCodeProof) =
            _absenceProof(actionHash, true, true, keccak256("wrong-controller"));
        assertFalse(verifier.verifyAppliedAction(wrongCodeHeader, wrongCodeProof, address(vault), actionHash));
    }

    function _absenceProof(bytes32 actionHash, bool occupied, bool nonempty, bytes32 controllerCodeHash)
        internal
        view
        returns (bytes memory header, bytes memory proof)
    {
        bytes32 storageRoot = keccak256(hex"80");
        bytes[] memory storageNodes;
        if (nonempty) {
            bytes32 provenActionHash = occupied ? actionHash : keccak256("another-action");
            bytes32 slot = keccak256(abi.encode(provenActionHash, uint256(0)));
            bytes32 key = keccak256(abi.encodePacked(slot));
            bytes memory storageLeaf = _rlpList(
                bytes.concat(_rlpBytes(_compactLeaf(key, 0)), _rlpBytes(_rlpBytes(hex"01")))
            );
            storageNodes = new bytes[](1);
            storageNodes[0] = storageLeaf;
            storageRoot = keccak256(storageLeaf);
        } else {
            storageNodes = new bytes[](0);
        }
        bytes memory account = _rlpList(bytes.concat(
            _rlpBytes(hex""), _rlpBytes(hex""),
            _rlpBytes(abi.encodePacked(storageRoot)), _rlpBytes(abi.encodePacked(controllerCodeHash))
        ));
        bytes32 accountKey = keccak256(abi.encodePacked(address(this)));
        bytes memory accountLeaf = _rlpList(bytes.concat(_rlpBytes(_compactLeaf(accountKey, 0)), _rlpBytes(account)));
        bytes[] memory accountNodes = new bytes[](1);
        accountNodes[0] = accountLeaf;
        header = EthereumHeaderFixture.header(block.timestamp, keccak256(accountLeaf), bytes32(uint256(1)));
        proof = abi.encode(actionHash, accountNodes, storageNodes);
    }

    function _proof(address sourceVault, bytes32 sourceLockId, bytes32 sourceDigest, bool branch)
        internal
        view
        returns (bytes memory header, bytes memory proof)
    {
        return _proofWithCodeHash(sourceVault, sourceLockId, sourceDigest, branch, address(vault).codehash);
    }

    function _proofWithCodeHash(
        address sourceVault,
        bytes32 sourceLockId,
        bytes32 sourceDigest,
        bool branch,
        bytes32 sourceCodeHash
    ) internal view returns (bytes memory header, bytes memory proof) {
        bytes32 slot = keccak256(abi.encode(sourceLockId, uint256(6)));
        bytes32 key = keccak256(abi.encodePacked(slot));
        bytes memory value = _rlpBytes(_trimZeroes(abi.encodePacked(sourceDigest)));
        bytes memory storageLeaf;
        bytes[] memory storageNodes;
        bytes32 storageRoot;
        if (branch) {
            storageLeaf = _rlpList(bytes.concat(_rlpBytes(_compactLeaf(key, 1)), _rlpBytes(value)));
            bytes memory fields;
            for (uint256 i; i < 17; ++i) {
                fields = bytes.concat(
                    fields,
                    i == _nibble(key, 0) ? _rlpBytes(abi.encodePacked(keccak256(storageLeaf))) : _rlpBytes(hex"")
                );
            }
            bytes memory branchNode = _rlpList(fields);
            storageNodes = new bytes[](2);
            storageNodes[0] = branchNode;
            storageNodes[1] = storageLeaf;
            storageRoot = keccak256(branchNode);
        } else {
            storageLeaf = _rlpList(bytes.concat(_rlpBytes(_compactLeaf(key, 0)), _rlpBytes(value)));
            storageNodes = new bytes[](1);
            storageNodes[0] = storageLeaf;
            storageRoot = keccak256(storageLeaf);
        }
        bytes memory account = _rlpList(
            bytes.concat(
                _rlpBytes(hex""),
                _rlpBytes(hex""),
                _rlpBytes(abi.encodePacked(storageRoot)),
                _rlpBytes(abi.encodePacked(sourceCodeHash))
            )
        );
        bytes32 accountKey = keccak256(abi.encodePacked(sourceVault));
        bytes memory accountLeaf = _rlpList(bytes.concat(_rlpBytes(_compactLeaf(accountKey, 0)), _rlpBytes(account)));
        bytes[] memory accountNodes = new bytes[](1);
        accountNodes[0] = accountLeaf;
        header = EthereumHeaderFixture.header(block.timestamp, keccak256(accountLeaf), bytes32(uint256(1)));
        proof = abi.encode(sourceLockId, accountNodes, storageNodes);
    }

    function _compactLeaf(bytes32 key, uint256 skipped) internal pure returns (bytes memory compact) {
        uint256 remaining = 64 - skipped;
        compact = new bytes(1 + remaining / 2);
        compact[0] = remaining % 2 == 0 ? bytes1(0x20) : bytes1(uint8(0x30 | _nibble(key, skipped)));
        for (uint256 i; i < remaining / 2; ++i) {
            uint256 offset = skipped + (remaining % 2) + i * 2;
            compact[i + 1] = bytes1(uint8((_nibble(key, offset) << 4) | _nibble(key, offset + 1)));
        }
    }

    function _nibble(bytes32 key, uint256 index) internal pure returns (uint8) {
        return uint8(uint256(key >> (4 * (63 - index))) & 15);
    }

    function _trimZeroes(bytes memory word) internal pure returns (bytes memory value) {
        uint256 start;
        while (start < word.length && word[start] == bytes1(0)) ++start;
        value = new bytes(word.length - start);
        for (uint256 i; i < value.length; ++i) {
            value[i] = word[start + i];
        }
    }

    function _rlpBytes(bytes memory value) internal pure returns (bytes memory) {
        if (value.length == 1 && uint8(value[0]) < 128) return value;
        if (value.length <= 55) return bytes.concat(bytes1(uint8(0x80 + value.length)), value);
        return bytes.concat(bytes1(0xb8), bytes1(uint8(value.length)), value);
    }

    function _rlpList(bytes memory encoded) internal pure returns (bytes memory) {
        if (encoded.length <= 55) return bytes.concat(bytes1(uint8(0xc0 + encoded.length)), encoded);
        if (encoded.length <= 255) return bytes.concat(bytes1(0xf8), bytes1(uint8(encoded.length)), encoded);
        return bytes.concat(bytes1(0xf9), bytes2(uint16(encoded.length)), encoded);
    }
}
