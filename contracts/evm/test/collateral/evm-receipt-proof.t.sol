// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EthereumVerifier} from "../../src/monad/collateral/EthereumVerifier.sol";
import {MonadVerifier} from "../../src/ethereum/collateral/MonadVerifier.sol";
import {MockConsensusLightClient} from "./light-client-verifier.t.sol";
import {EthereumHeaderFixture} from "./EthereumHeaderFixture.sol";

contract EvmReceiptProofTest is Test {
    MockConsensusLightClient ethereumClient;
    MockConsensusLightClient monadClient;
    EthereumVerifier ethereumVerifier;
    MonadVerifier monadVerifier;
    address sourceVault = address(0xBEEF);
    address monadCore = address(0xCAFE);
    address recipient = address(0xABCD);
    address factory = address(0xFACA);
    address inbox = address(0x1B0);
    bytes32 creditId = keccak256("credit");
    bytes32 actionHash = keccak256("action");
    bytes32 lockId = keccak256("lock");

    function setUp() public {
        vm.warp(2 days);
        ethereumClient = new MockConsensusLightClient(1, 1, keccak256("ethereum"), 1 days);
        monadClient = new MockConsensusLightClient(143, 1, keccak256("monad"), 1 days);
        ethereumVerifier = new EthereumVerifier(
            address(ethereumClient), sourceVault, keccak256("vault-code"), address(0xC0DE), keccak256("controller-code")
        );
        monadVerifier = new MonadVerifier(address(monadClient));
        ethereumClient.setResults(true, true);
        monadClient.setResults(true, true);
    }

    function testVerifiesFinalizedEthereumAppliedLog() public {
        bytes32 digest = keccak256(abi.encode(actionHash, lockId, recipient, uint256(400), uint8(1)));
        (bytes memory header, bytes memory proof) = _ethereumProof(_appliedReceipt(400, 1, recipient), 0, 0, false);
        (, bytes32 receiptsRoot,) = EthereumHeaderFixture.roots(header);
        assertEq(receiptsRoot, 0xb1ad6fbf80b264f407f6079a0fb9a22d8c21e6573d8848be1729375237d8c754);
        assertEq(digest, 0x1a21ff0d99c308d4c18674e4e852277b291659c646232d2a265f51588a3bd6e5);
        assertTrue(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
        assertFalse(ethereumVerifier.verifyEvent(header, proof, address(0xBAD), digest));
        assertFalse(ethereumVerifier.verifyEvent(header, proof, sourceVault, keccak256("different")));
        ethereumClient.setResults(false, true);
        assertFalse(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
        ethereumClient.setResults(true, true);
        (, bytes32 root,) = EthereumHeaderFixture.roots(header);
        bytes memory oldHeader =
            EthereumHeaderFixture.header(block.timestamp - 1 days - 1, bytes32(uint256(1)), root);
        assertFalse(ethereumVerifier.verifyFinality(oldHeader));
        assertTrue(ethereumVerifier.verifyEvent(oldHeader, proof, sourceVault, digest));
    }

    function testVerifiesFinalizedMonadAuthorizationInTypedReceipt() public view {
        bytes32 digest = keccak256(abi.encode(creditId, actionHash, uint8(0)));
        bytes memory receipt = bytes.concat(bytes1(0x02), _authorizationReceipt(0));
        (bytes memory header, bytes memory proof) = _proof(receipt, 128, 0, false);
        assertTrue(monadVerifier.verifyEvent(header, proof, monadCore, digest));
        assertFalse(monadVerifier.verifyEvent(header, proof, sourceVault, digest));
        assertFalse(monadVerifier.verifyEvent(header, proof, monadCore, keccak256("wrong")));
    }

    function testVerifiesHashedReceiptBranch() public view {
        bytes32 digest = keccak256(abi.encode(creditId, actionHash, uint8(1)));
        (bytes memory header, bytes memory proof) = _proof(_authorizationReceipt(1), 1, 0, true);
        assertTrue(monadVerifier.verifyEvent(header, proof, monadCore, digest));
    }

    function testVerifiesExactFinalizedRecoveryOperation() public view {
        bytes32 operationId = keccak256("operation");
        bytes32 operationDigest = keccak256("operation-digest");
        bytes32 digest = keccak256(abi.encode(operationId, operationDigest, inbox));
        (bytes memory header, bytes memory proof) = _proof(
            _recoveryReceipt(operationId, operationDigest, inbox), 0, 0, false
        );
        assertTrue(monadVerifier.verifyRecoveryOperation(header, proof, factory, digest));
        assertFalse(monadVerifier.verifyRecoveryOperation(header, proof, monadCore, digest));
        assertFalse(monadVerifier.verifyRecoveryOperation(header, proof, factory, keccak256("wrong")));
        assertFalse(monadVerifier.verifyEvent(header, proof, factory, digest));
        (header, proof) = _proof(_recoveryReceipt(operationId, operationDigest, address(0)), 0, 0, false);
        assertFalse(monadVerifier.verifyRecoveryOperation(header, proof, factory, digest));
    }

    function testVerifiesHashedExtensionBranchAndLeaf() public view {
        bytes32 digest = keccak256(abi.encode(creditId, actionHash, uint8(1)));
        (bytes memory header, bytes memory proof) = _extensionProof(_authorizationReceipt(1));
        assertTrue(monadVerifier.verifyEvent(header, proof, monadCore, digest));
        (uint256 txIndex, uint256 logIndex, bytes[] memory nodes) = abi.decode(proof, (uint256, uint256, bytes[]));
        bytes memory swap = nodes[1];
        nodes[1] = nodes[2];
        nodes[2] = swap;
        assertFalse(monadVerifier.verifyEvent(header, abi.encode(txIndex, logIndex, nodes), monadCore, digest));
    }

    function testSelectsTheExactLogIndex() public view {
        bytes32 digest = keccak256(abi.encode(actionHash, lockId, recipient, uint256(400), uint8(1)));
        bytes memory receipt =
            _receiptLogs(bytes.concat(_appliedLog(300, 1, recipient), _appliedLog(400, 1, recipient)), true);
        (bytes memory header, bytes memory proof) = _ethereumProof(receipt, 0, 1, false);
        assertTrue(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
        (uint256 txIndex,, bytes[] memory nodes) = abi.decode(proof, (uint256, uint256, bytes[]));
        assertFalse(ethereumVerifier.verifyEvent(header, abi.encode(txIndex, uint256(0), nodes), sourceVault, digest));
    }

    function testRejectsNonCanonicalInlineChildAndRlpLength() public view {
        bytes32 digest = keccak256(abi.encode(creditId, actionHash, uint8(1)));
        bytes memory key = hex"01";
        bytes memory leaf = _rlpList(bytes.concat(_rlpBytes(hex"31"), _rlpBytes(_authorizationReceipt(1))));
        bytes memory fields;
        for (uint256 i; i < 17; ++i) {
            fields = bytes.concat(fields, i == uint8(key[0]) >> 4 ? leaf : _rlpBytes(hex""));
        }
        bytes memory branch = _rlpList(fields);
        bytes[] memory nodes = new bytes[](1);
        nodes[0] = branch;
        bytes memory header = abi.encode(block.timestamp, bytes32(uint256(1)), keccak256(branch));
        assertFalse(monadVerifier.verifyEvent(header, abi.encode(uint256(1), uint256(0), nodes), monadCore, digest));
        bytes memory proof;
        (header, proof) = _proof(hex"f90001c0", 0, 0, false);
        assertFalse(monadVerifier.verifyEvent(header, proof, monadCore, digest));
    }

    function testRejectsWrongPathLogPositionRootAndExtraNodes() public view {
        bytes32 digest = keccak256(abi.encode(actionHash, lockId, recipient, uint256(400), uint8(1)));
        (bytes memory header, bytes memory proof) = _ethereumProof(_appliedReceipt(400, 1, recipient), 0, 0, false);
        (uint256 txIndex, uint256 logIndex, bytes[] memory nodes) = abi.decode(proof, (uint256, uint256, bytes[]));
        assertFalse(ethereumVerifier.verifyEvent(header, abi.encode(txIndex + 1, logIndex, nodes), sourceVault, digest));
        assertFalse(ethereumVerifier.verifyEvent(header, abi.encode(txIndex, logIndex + 1, nodes), sourceVault, digest));
        bytes[] memory extra = new bytes[](2);
        extra[0] = nodes[0];
        extra[1] = nodes[0];
        assertFalse(ethereumVerifier.verifyEvent(header, abi.encode(txIndex, logIndex, extra), sourceVault, digest));
        assertFalse(
            ethereumVerifier.verifyEvent(
                EthereumHeaderFixture.header(block.timestamp, bytes32(uint256(1)), keccak256("wrong-root")),
                proof,
                sourceVault,
                digest
            )
        );
        assertFalse(
            ethereumVerifier.verifyEvent(
                EthereumHeaderFixture.header(block.timestamp, bytes32(uint256(1)), bytes32(0)),
                proof,
                sourceVault,
                digest
            )
        );
        assertFalse(ethereumVerifier.verifyEvent(header, hex"1234", sourceVault, digest));
    }

    function testRejectsForgedLogFieldsAndFailedReceipt() public view {
        bytes32 digest = keccak256(abi.encode(actionHash, lockId, recipient, uint256(400), uint8(1)));
        (bytes memory header, bytes memory proof) = _ethereumProof(_appliedReceipt(400, 0, recipient), 0, 0, false);
        assertFalse(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
        (header, proof) = _ethereumProof(_appliedReceipt(0, 1, recipient), 0, 0, false);
        assertFalse(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
        (header, proof) = _ethereumProof(_appliedReceipt(400, 1, address(0xBAD)), 0, 0, false);
        assertFalse(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
        (header, proof) = _ethereumProof(_receipt(_appliedLog(400, 1, recipient), false), 0, 0, false);
        assertFalse(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
        (header, proof) = _ethereumProof(hex"c100", 0, 0, false);
        assertFalse(ethereumVerifier.verifyEvent(header, proof, sourceVault, digest));
    }

    function testRejectsWrongMonadEventShape() public view {
        bytes32 digest = keccak256(abi.encode(creditId, actionHash, uint8(0)));
        (bytes memory header, bytes memory proof) = _proof(_authorizationReceipt(2), 0, 0, false);
        assertFalse(monadVerifier.verifyEvent(header, proof, monadCore, digest));
        (header, proof) = _proof(_appliedReceipt(400, 1, recipient), 0, 0, false);
        assertFalse(monadVerifier.verifyEvent(header, proof, monadCore, digest));
    }

    function _proof(bytes memory receipt, uint256 txIndex, uint256 logIndex, bool branch)
        internal
        view
        returns (bytes memory header, bytes memory proof)
    {
        bytes memory key = _receiptKey(txIndex);
        bytes memory path =
            branch ? bytes.concat(bytes1(uint8(0x30 | (uint8(key[0]) & 15)))) : bytes.concat(hex"20", key);
        bytes memory leaf = _rlpList(bytes.concat(_rlpBytes(path), _rlpBytes(receipt)));
        bytes[] memory nodes;
        bytes32 root;
        if (branch) {
            bytes memory fields;
            for (uint256 i; i < 17; ++i) {
                fields = bytes.concat(
                    fields, i == uint8(key[0]) >> 4 ? _rlpBytes(abi.encodePacked(keccak256(leaf))) : _rlpBytes(hex"")
                );
            }
            bytes memory branchNode = _rlpList(fields);
            nodes = new bytes[](2);
            nodes[0] = branchNode;
            nodes[1] = leaf;
            root = keccak256(branchNode);
        } else {
            nodes = new bytes[](1);
            nodes[0] = leaf;
            root = keccak256(leaf);
        }
        header = abi.encode(block.timestamp, bytes32(uint256(1)), root);
        proof = abi.encode(txIndex, logIndex, nodes);
    }

    function _ethereumProof(bytes memory receipt, uint256 txIndex, uint256 logIndex, bool branch)
        internal
        view
        returns (bytes memory header, bytes memory proof)
    {
        (bytes memory rootsHeader, bytes memory receiptProof) = _proof(receipt, txIndex, logIndex, branch);
        (uint256 timestamp, bytes32 stateRoot, bytes32 receiptsRoot) =
            abi.decode(rootsHeader, (uint256, bytes32, bytes32));
        return (EthereumHeaderFixture.header(timestamp, stateRoot, receiptsRoot), receiptProof);
    }

    function _extensionProof(bytes memory receipt) internal view returns (bytes memory header, bytes memory proof) {
        bytes memory leaf = _rlpList(bytes.concat(_rlpBytes(hex"2080"), _rlpBytes(receipt)));
        bytes memory fields;
        for (uint256 i; i < 17; ++i) {
            fields = bytes.concat(fields, i == 1 ? _rlpBytes(abi.encodePacked(keccak256(leaf))) : _rlpBytes(hex""));
        }
        bytes memory branch = _rlpList(fields);
        bytes memory extension =
            _rlpList(bytes.concat(_rlpBytes(hex"18"), _rlpBytes(abi.encodePacked(keccak256(branch)))));
        bytes[] memory nodes = new bytes[](3);
        nodes[0] = extension;
        nodes[1] = branch;
        nodes[2] = leaf;
        header = abi.encode(block.timestamp, bytes32(uint256(1)), keccak256(extension));
        proof = abi.encode(uint256(128), uint256(0), nodes);
    }

    function _receiptKey(uint256 index) internal pure returns (bytes memory) {
        if (index == 0) return hex"80";
        if (index < 128) return abi.encodePacked(bytes1(uint8(index)));
        return abi.encodePacked(bytes1(0x81), bytes1(uint8(index)));
    }

    function _authorizationReceipt(uint256 kind) internal view returns (bytes memory) {
        bytes memory topics = _rlpList(
            bytes.concat(
                _rlpBytes(abi.encodePacked(keccak256("RemoteActionAuthorized(bytes32,bytes32,uint8)"))),
                _rlpBytes(abi.encodePacked(creditId)),
                _rlpBytes(abi.encodePacked(actionHash))
            )
        );
        bytes memory log =
            _rlpList(bytes.concat(_rlpBytes(abi.encodePacked(monadCore)), topics, _rlpBytes(abi.encode(kind))));
        return _receipt(log, true);
    }

    function _recoveryReceipt(bytes32 operationId, bytes32 operationDigest, address targetInbox)
        internal
        view
        returns (bytes memory)
    {
        bytes memory topics = _rlpList(bytes.concat(
            _rlpBytes(abi.encodePacked(keccak256("RecoveryOperationCreated(bytes32,bytes32,address)"))),
            _rlpBytes(abi.encodePacked(operationId)),
            _rlpBytes(abi.encodePacked(operationDigest)),
            _rlpBytes(abi.encode(targetInbox))
        ));
        return _receipt(_rlpList(bytes.concat(_rlpBytes(abi.encodePacked(factory)), topics, _rlpBytes(hex""))), true);
    }

    function _appliedReceipt(uint256 amount, uint256 kind, address destination) internal view returns (bytes memory) {
        return _receipt(_appliedLog(amount, kind, destination), true);
    }

    function _appliedLog(uint256 amount, uint256 kind, address destination) internal view returns (bytes memory) {
        bytes memory topics = _rlpList(
            bytes.concat(
                _rlpBytes(abi.encodePacked(keccak256("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)"))),
                _rlpBytes(abi.encodePacked(actionHash)),
                _rlpBytes(abi.encodePacked(lockId)),
                _rlpBytes(abi.encode(destination))
            )
        );
        return
            _rlpList(
                bytes.concat(_rlpBytes(abi.encodePacked(sourceVault)), topics, _rlpBytes(abi.encode(amount, kind)))
            );
    }

    function _receipt(bytes memory log, bool success) internal pure returns (bytes memory) {
        return _receiptLogs(log, success);
    }

    function _receiptLogs(bytes memory logs, bool success) internal pure returns (bytes memory) {
        return _rlpList(
            bytes.concat(
                _rlpBytes(success ? abi.encodePacked(bytes1(0x01)) : new bytes(0)),
                _rlpBytes(hex"01"),
                _rlpBytes(new bytes(256)),
                _rlpList(logs)
            )
        );
    }

    function _rlpBytes(bytes memory value) internal pure returns (bytes memory) {
        if (value.length == 1 && uint8(value[0]) < 128) return value;
        if (value.length <= 55) return bytes.concat(bytes1(uint8(0x80 + value.length)), value);
        if (value.length <= 255) return bytes.concat(bytes1(0xb8), bytes1(uint8(value.length)), value);
        return bytes.concat(bytes1(0xb9), bytes2(uint16(value.length)), value);
    }

    function _rlpList(bytes memory encoded) internal pure returns (bytes memory) {
        if (encoded.length <= 55) return bytes.concat(bytes1(uint8(0xc0 + encoded.length)), encoded);
        if (encoded.length <= 255) return bytes.concat(bytes1(0xf8), bytes1(uint8(encoded.length)), encoded);
        return bytes.concat(bytes1(0xf9), bytes2(uint16(encoded.length)), encoded);
    }
}
