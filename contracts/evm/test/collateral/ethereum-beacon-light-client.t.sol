// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EthereumBeaconSsz} from "../../src/monad/collateral/EthereumBeaconSsz.sol";
import {EthereumBeaconBls} from "../../src/monad/collateral/EthereumBeaconBls.sol";
import {EthereumBeaconLightClient} from "../../src/monad/collateral/EthereumBeaconLightClient.sol";
import {EthereumBeaconPeriods} from "../../src/monad/collateral/EthereumBeaconPeriods.sol";

contract BeaconProofHarness {
    function beaconRoot(EthereumBeaconSsz.BeaconHeader memory header) external pure returns (bytes32) {
        return EthereumBeaconSsz.beaconRoot(header);
    }

    function branch(bytes32 leaf, bytes32[] memory siblings, uint256 gindex, bytes32 root)
        external pure returns (bool)
    {
        return EthereumBeaconSsz.verifyBranch(leaf, siblings, gindex, root);
    }

    function execution(bytes32 blockHash, bytes32[] memory siblings, bytes32 bodyRoot)
        external pure returns (bool)
    {
        return EthereumBeaconSsz.verifyExecutionBlockHash(blockHash, siblings, bodyRoot);
    }

    function historical(bytes32 targetRoot, uint64 blockSlot, uint64 finalizedSlot,
        bytes32[] memory siblings, bytes32 stateRoot) external pure returns (bool) {
        return EthereumBeaconSsz.verifyHistoricalBlock(targetRoot, blockSlot, finalizedSlot, siblings, stateRoot);
    }

    function committeeRoot(bytes calldata pubkeys, bytes calldata aggregatePubkey)
        external pure returns (bytes32)
    {
        return EthereumBeaconSsz.committeeRoot(pubkeys, aggregatePubkey);
    }

    function hashToG2(bytes32 message) external view returns (bytes memory) {
        return EthereumBeaconBls.hashToG2(message);
    }

    function fastAggregateVerify(
        bytes32 signingRoot,
        bytes calldata bits,
        bytes calldata pubkeys,
        bytes calldata participants,
        bytes calldata signature
    ) external view returns (bool) {
        return EthereumBeaconBls.fastAggregateVerify(signingRoot, bits, pubkeys, participants, signature);
    }

    function advance(
        uint256 storePeriod,
        uint256 finalizedPeriod,
        uint256 attestedPeriod,
        bytes32 currentRoot,
        bytes32 knownNextRoot,
        bytes32 provenNextRoot
    ) external pure returns (bytes32, bytes32, bool, bool) {
        return EthereumBeaconPeriods.advance(
            storePeriod, finalizedPeriod, attestedPeriod, currentRoot, knownNextRoot, provenNextRoot
        );
    }
}

contract EthereumBeaconLightClientTest is Test {
    bytes constant G1 = hex"00000000000000000000000000000000"
        hex"17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
        hex"00000000000000000000000000000000"
        hex"08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1";
    bytes constant COMPRESSED_G1 =
        hex"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";

    BeaconProofHarness harness;

    function setUp() public {
        harness = new BeaconProofHarness();
    }

    function testBeaconHeaderMatchesIndependentSszVector() public view {
        EthereumBeaconSsz.BeaconHeader memory header = EthereumBeaconSsz.BeaconHeader({
            slot: 13_164_544,
            proposerIndex: 1,
            parentRoot: bytes32(uint256(2)),
            stateRoot: bytes32(uint256(3)),
            bodyRoot: bytes32(uint256(4))
        });
        assertEq(harness.beaconRoot(header),
            0x8a5352acfe8f616aae65cb93138b569588ad764d074ec3cdd5149c0b9e32f04e);
    }

    function testSszBranchRejectsWrongGeneralizedIndexAndSibling() public view {
        bytes32 leaf = keccak256("block-hash");
        bytes32[] memory branch = new bytes32[](9);
        bytes32 root = leaf;
        uint256 index = 812;
        for (uint256 i; i < 9; ++i) {
            root = index & 1 == 0 ? sha256(abi.encodePacked(root, branch[i]))
                : sha256(abi.encodePacked(branch[i], root));
            index >>= 1;
        }
        assertTrue(harness.execution(leaf, branch, root));
        assertFalse(harness.branch(leaf, branch, 813, root));
        branch[0] = bytes32(uint256(1));
        assertFalse(harness.execution(leaf, branch, root));
    }

    function testHistoricalBlockProofBindsSlotAndFinalizedState() public view {
        uint64 blockSlot = uint64(411_392 * 32 + 8190);
        bytes32 root = keccak256("historical-beacon-block");
        bytes32[] memory branch = new bytes32[](19);
        uint256 index = 69 * 8192 + uint256(blockSlot) % 8192;
        bytes32 stateRoot = root;
        for (uint256 i; i < 19; ++i) {
            stateRoot = index & 1 == 0 ? sha256(abi.encodePacked(stateRoot, branch[i]))
                : sha256(abi.encodePacked(branch[i], stateRoot));
            index >>= 1;
        }
        assertTrue(harness.historical(root, blockSlot, blockSlot + 3, branch, stateRoot));
        assertFalse(harness.historical(root, blockSlot + 1, blockSlot + 3, branch, stateRoot));
        assertFalse(harness.historical(root, blockSlot, blockSlot + 8193, branch, stateRoot));
        branch[0] = bytes32(uint256(1));
        assertFalse(harness.historical(root, blockSlot, blockSlot + 3, branch, stateRoot));
    }

    function testFinalizedBlockUsesStoredCheckpointRoot() public {
        uint64 checkpointSlot = uint64(411_392 * 32 + 100);
        uint64 targetSlot = checkpointSlot - 1;
        bytes memory rawExecutionHeader = hex"c0";
        bytes32 executionHash = keccak256(rawExecutionHeader);
        bytes32[] memory executionBranch = new bytes32[](9);
        bytes32 bodyRoot = executionHash;
        uint256 executionIndex = 812;
        for (uint256 i; i < 9; ++i) {
            bodyRoot = executionIndex & 1 == 0 ? sha256(abi.encodePacked(bodyRoot, bytes32(0)))
                : sha256(abi.encodePacked(bytes32(0), bodyRoot));
            executionIndex >>= 1;
        }
        EthereumBeaconSsz.BeaconHeader memory target = EthereumBeaconSsz.BeaconHeader(
            targetSlot, 1, bytes32(uint256(2)), bytes32(uint256(3)), bodyRoot
        );
        bytes32 targetRoot = harness.beaconRoot(target);
        (bytes32 blockRootsRoot, bytes32[] memory vectorBranch) =
            _zeroBranch(targetRoot, 8192 + uint256(targetSlot) % 8192, 13);

        bytes memory compressed = new bytes(512 * 48);
        bytes memory key = COMPRESSED_G1;
        for (uint256 i; i < 512; ++i) {
            assembly ("memory-safe") {
                mcopy(add(add(compressed, 0x20), mul(i, 48)), add(key, 0x20), 48)
            }
        }
        bytes32 committee = harness.committeeRoot(compressed, key);
        (bytes32 stateRoot, bytes32[] memory blockRootsBranch, bytes32[] memory committeeBranch) =
            _stateBranches(blockRootsRoot, committee);
        EthereumBeaconSsz.BeaconHeader memory checkpoint = EthereumBeaconSsz.BeaconHeader(
            checkpointSlot, 1, bytes32(uint256(4)), stateRoot, bytes32(uint256(5))
        );
        bytes32 checkpointRoot = harness.beaconRoot(checkpoint);
        vm.warp(1_606_824_023 + uint256(checkpointSlot) * 12 + 12);
        EthereumBeaconLightClient client = new EthereumBeaconLightClient(
            checkpointRoot, checkpoint, committee, committeeBranch, address(this)
        );
        bytes32[] memory historicalBranch = new bytes32[](19);
        for (uint256 i; i < 13; ++i) historicalBranch[i] = vectorBranch[i];
        for (uint256 i; i < 6; ++i) historicalBranch[i + 13] = blockRootsBranch[i];
        client.submitFinalizedBlock(checkpointRoot, target, historicalBranch, executionHash, executionBranch);
        (bytes32 storedHash, uint64 storedSlot) = client.finalizedExecution(targetRoot);
        assertEq(storedHash, executionHash);
        assertEq(storedSlot, targetSlot);
        vm.expectRevert(EthereumBeaconLightClient.InvalidUpdate.selector);
        client.submitFinalizedBlock(keccak256("unknown-checkpoint"), target, historicalBranch, executionHash, executionBranch);
        bytes memory headerRef = abi.encode(rawExecutionHeader, abi.encode(targetRoot));
        assertTrue(client.verifyFinality(headerRef));
        vm.warp(block.timestamp + 2 days);
        assertFalse(client.verifyFinality(headerRef));
        assertTrue(client.verifyHistoricalFinality(headerRef));
        vm.warp(block.timestamp + 13 days);
        assertFalse(client.verifyHistoricalFinality(headerRef));

        uint64 newerSlot = uint64((block.timestamp - client.genesisTime()) / 12 - 1);
        bytes memory newExecutionHeader = hex"c1";
        bytes32 newExecutionHash = keccak256(newExecutionHeader);
        (bytes32 newBodyRoot, bytes32[] memory newExecutionBranch) =
            _zeroBranch(newExecutionHash, 812, 9);
        (bytes32 newStateRoot, bytes32[] memory newCommitteeBranch) = _branch(committee, 86);
        EthereumBeaconSsz.BeaconHeader memory newer = EthereumBeaconSsz.BeaconHeader(
            newerSlot, 1, bytes32(uint256(7)), newStateRoot, newBodyRoot
        );
        bytes32 newerRoot = harness.beaconRoot(newer);
        EthereumBeaconSsz.BeaconHeader memory secondProposal = EthereumBeaconSsz.BeaconHeader(
            newerSlot + 1, 1, bytes32(uint256(8)), newStateRoot, newBodyRoot
        );
        bytes32 secondProposalRoot = harness.beaconRoot(secondProposal);
        vm.expectRevert(EthereumBeaconLightClient.Unauthorized.selector);
        vm.prank(address(0xBEEF));
        client.queueCheckpoint(newerRoot, newerSlot);
        client.queueCheckpoint(newerRoot, newerSlot);
        client.queueCheckpoint(secondProposalRoot, secondProposal.slot);
        vm.expectRevert(EthereumBeaconLightClient.NotReady.selector);
        client.recoverCheckpoint(
            newerRoot, newer, committee, newCommitteeBranch, newExecutionHash, newExecutionBranch
        );
        vm.warp(block.timestamp + 2 days);
        newCommitteeBranch[0] = bytes32(uint256(1));
        vm.expectRevert(EthereumBeaconLightClient.InvalidUpdate.selector);
        client.recoverCheckpoint(
            newerRoot, newer, committee, newCommitteeBranch, newExecutionHash, newExecutionBranch
        );
        newCommitteeBranch[0] = bytes32(0);
        client.recoverCheckpoint(
            newerRoot, newer, committee, newCommitteeBranch, newExecutionHash, newExecutionBranch
        );
        assertEq(client.checkpointGeneration(), 2);
        assertEq(client.finalizedSlot(), newerSlot);
        assertEq(client.currentCommitteeRoot(), committee);
        assertEq(client.nextCommitteeRoot(), bytes32(0));
        (, , uint64 pendingGeneration) = client.pendingCheckpoints(secondProposalRoot);
        assertEq(pendingGeneration, 1);
        vm.expectRevert(EthereumBeaconLightClient.InvalidUpdate.selector);
        client.recoverCheckpoint(
            secondProposalRoot, secondProposal, committee, newCommitteeBranch, newExecutionHash, newExecutionBranch
        );
        client.cancelCheckpoint(secondProposalRoot);
        client.queueCheckpoint(secondProposalRoot, secondProposal.slot);
        (, , pendingGeneration) = client.pendingCheckpoints(secondProposalRoot);
        assertEq(pendingGeneration, 2);
        assertFalse(client.verifyHistoricalFinality(headerRef));
        assertEq(client.headerTimestamp(headerRef), 0);
        bytes memory recoveredHeaderRef = abi.encode(newExecutionHeader, abi.encode(newerRoot));
        assertTrue(client.verifyHistoricalFinality(recoveredHeaderRef));
        vm.expectRevert(EthereumBeaconLightClient.InvalidUpdate.selector);
        client.submitFinalizedBlock(checkpointRoot, target, historicalBranch, executionHash, executionBranch);
    }

    function _stateBranches(bytes32 blockRootsRoot, bytes32 committeeRoot)
        private pure returns (bytes32 stateRoot, bytes32[] memory blockRootsBranch, bytes32[] memory committeeBranch)
    {
        bytes32[64] memory level;
        level[5] = blockRootsRoot;
        level[22] = committeeRoot;
        blockRootsBranch = new bytes32[](6);
        committeeBranch = new bytes32[](6);
        uint256 blockIndex = 5;
        uint256 committeeIndex = 22;
        uint256 width = 64;
        for (uint256 depth; depth < 6; ++depth) {
            blockRootsBranch[depth] = level[blockIndex ^ 1];
            committeeBranch[depth] = level[committeeIndex ^ 1];
            for (uint256 i; i < width / 2; ++i) {
                level[i] = sha256(abi.encodePacked(level[2 * i], level[2 * i + 1]));
            }
            blockIndex >>= 1;
            committeeIndex >>= 1;
            width >>= 1;
        }
        stateRoot = level[0];
    }

    function _zeroBranch(bytes32 leaf, uint256 index, uint256 depth)
        private pure returns (bytes32 root, bytes32[] memory branch)
    {
        branch = new bytes32[](depth);
        root = leaf;
        for (uint256 i; i < depth; ++i) {
            root = index & 1 == 0 ? sha256(abi.encodePacked(root, bytes32(0)))
                : sha256(abi.encodePacked(bytes32(0), root));
            index >>= 1;
        }
    }

    function testBootstrapRequiresTrustedRootAndCommitteeBranch() public {
        bytes memory compressed = new bytes(512 * 48);
        bytes memory key = COMPRESSED_G1;
        for (uint256 i; i < 512; ++i) {
            assembly ("memory-safe") {
                mcopy(add(add(compressed, 0x20), mul(i, 48)), add(key, 0x20), 48)
            }
        }
        bytes32 committee = harness.committeeRoot(compressed, key);
        assertEq(committee, 0xd1d6ee037ad01a7d815889a3a14cc0bd189970917bd19f03015fb4c3e1e239ec);
        (bytes32 stateRoot, bytes32[] memory branch) = _branch(committee, 86);
        uint64 slot = uint64(411_392 * 32 + 100);
        EthereumBeaconSsz.BeaconHeader memory checkpoint = EthereumBeaconSsz.BeaconHeader({
            slot: slot,
            proposerIndex: 1,
            parentRoot: bytes32(uint256(2)),
            stateRoot: stateRoot,
            bodyRoot: bytes32(uint256(4))
        });
        bytes32 root = harness.beaconRoot(checkpoint);
        vm.warp(1_606_824_023 + uint256(slot) * 12 + 12);
        EthereumBeaconLightClient client = new EthereumBeaconLightClient(root, checkpoint, committee, branch, address(this));
        assertEq(client.bootstrapHash(), root);
        assertEq(client.currentCommitteeRoot(), committee);
        assertEq(client.finalizedSlot(), slot);
        (bytes32 storedState, uint64 storedSlot) = client.finalizedCheckpoints(root);
        assertEq(storedState, stateRoot);
        assertEq(storedSlot, slot);
        vm.expectRevert(EthereumBeaconLightClient.InvalidBootstrap.selector);
        new EthereumBeaconLightClient(keccak256("wrong-root"), checkpoint, committee, branch, address(this));
        branch[0] = bytes32(uint256(1));
        vm.expectRevert(EthereumBeaconLightClient.InvalidBootstrap.selector);
        new EthereumBeaconLightClient(root, checkpoint, committee, branch, address(this));
        branch[0] = bytes32(0);
        vm.expectRevert(EthereumBeaconLightClient.InvalidBootstrap.selector);
        new EthereumBeaconLightClient(root, checkpoint, committee, branch, address(0xBEEF));
    }

    function testCheckpointRecoveryWaitsForStalenessAndCanBeCancelled() public {
        uint64 slot = uint64(411_392 * 32 + 100);
        bytes32 committee = keccak256("committee");
        (bytes32 stateRoot, bytes32[] memory committeeBranch) = _branch(committee, 86);
        EthereumBeaconSsz.BeaconHeader memory initial = EthereumBeaconSsz.BeaconHeader(
            slot, 1, bytes32(uint256(1)), stateRoot, bytes32(uint256(2))
        );
        vm.warp(1_606_824_023 + uint256(slot + 1) * 12);
        EthereumBeaconLightClient client = new EthereumBeaconLightClient(
            harness.beaconRoot(initial), initial, committee, committeeBranch, address(this)
        );
        bytes32 executionHash = keccak256("execution");
        (bytes32 bodyRoot, bytes32[] memory executionBranch) = _zeroBranch(executionHash, 812, 9);
        EthereumBeaconSsz.BeaconHeader memory proposed = EthereumBeaconSsz.BeaconHeader(
            slot + 1, 1, bytes32(uint256(3)), stateRoot, bodyRoot
        );
        bytes32 root = harness.beaconRoot(proposed);
        client.queueCheckpoint(root, proposed.slot);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(EthereumBeaconLightClient.InvalidUpdate.selector);
        client.recoverCheckpoint(root, proposed, committee, committeeBranch, executionHash, executionBranch);
        client.cancelCheckpoint(root);
        vm.expectRevert(EthereumBeaconLightClient.NotReady.selector);
        client.recoverCheckpoint(root, proposed, committee, committeeBranch, executionHash, executionBranch);
    }

    function testCommitteePeriodTransitions() public view {
        bytes32 current = bytes32(uint256(1));
        bytes32 next = bytes32(uint256(2));
        bytes32 future = bytes32(uint256(3));
        (bytes32 a, bytes32 b, bool rotated, bool valid) = harness.advance(100, 100, 100, current, bytes32(0), next);
        assertTrue(valid);
        assertFalse(rotated);
        assertEq(a, current);
        assertEq(b, next);

        (a, b, rotated, valid) = harness.advance(100, 100, 101, current, next, future);
        assertTrue(valid);
        assertFalse(rotated);
        assertEq(a, current);
        assertEq(b, next);

        (a, b, rotated, valid) = harness.advance(100, 100, 100, current, next, bytes32(0));
        assertTrue(valid);
        assertFalse(rotated);
        assertEq(a, current);
        assertEq(b, next);

        (a, b, rotated, valid) = harness.advance(100, 100, 100, current, bytes32(0), bytes32(0));
        assertTrue(valid);
        assertFalse(rotated);
        assertEq(a, current);
        assertEq(b, bytes32(0));

        (a, b, rotated, valid) = harness.advance(100, 101, 101, current, next, future);
        assertTrue(valid);
        assertTrue(rotated);
        assertEq(a, next);
        assertEq(b, future);

        (a, b, rotated, valid) = harness.advance(100, 101, 101, current, next, bytes32(0));
        assertTrue(valid);
        assertTrue(rotated);
        assertEq(a, next);
        assertEq(b, bytes32(0));

        (,,, valid) = harness.advance(100, 100, 101, current, bytes32(0), future);
        assertFalse(valid);
        (,,, valid) = harness.advance(100, 100, 100, current, next, future);
        assertFalse(valid);
        (,,, valid) = harness.advance(100, 102, 102, current, next, future);
        assertFalse(valid);
    }

    function testOlderFullUpdateCanFillMissingNextCommittee() public {
        uint64 slot = uint64(411_392 * 32 + 100);
        (EthereumBeaconLightClient.CommitteeWitness memory witness, bytes memory bits) = _committeeWitness();
        bytes32 committee = harness.committeeRoot(witness.compressedPubkeys, witness.aggregatePubkey);
        (bytes32 stateRoot, bytes32[] memory branch) = _branch(committee, 86);
        EthereumBeaconSsz.BeaconHeader memory checkpoint = EthereumBeaconSsz.BeaconHeader(
            slot, 1, bytes32(uint256(1)), stateRoot, bytes32(uint256(2))
        );
        vm.warp(1_606_824_023 + uint256(slot + 10) * 12);
        EthereumBeaconLightClient client = new EthereumBeaconLightClient(
            harness.beaconRoot(checkpoint), checkpoint, committee, branch, address(this)
        );
        vm.mockCall(address(0x05), bytes(""), new bytes(48));
        vm.mockCall(address(0x11), bytes(""), new bytes(256));
        vm.mockCall(address(0x0d), bytes(""), new bytes(256));
        vm.mockCall(address(0x0c), bytes(""), G1);
        vm.mockCall(address(0x0f), bytes(""), abi.encode(uint256(1)));

        EthereumBeaconLightClient.Update memory fresh = _update(slot + 3, slot + 4, slot + 5, bytes32(0), bits);
        client.submitUpdate(fresh, witness);
        assertEq(client.finalizedSlot(), slot + 3);
        assertEq(client.nextCommitteeRoot(), bytes32(0));

        EthereumBeaconLightClient.Update memory older = _update(slot + 1, slot + 2, slot + 3, committee, bits);
        older.nextCommitteeBranch[0] = bytes32(uint256(1));
        vm.expectRevert(EthereumBeaconLightClient.InvalidUpdate.selector);
        client.submitUpdate(older, witness);
        older = _update(slot + 1, slot + 2, slot + 3, committee, bits);
        client.submitUpdate(older, witness);
        assertEq(client.finalizedSlot(), slot + 3);
        assertEq(client.nextCommitteeRoot(), committee);
        vm.expectRevert(EthereumBeaconLightClient.InvalidUpdate.selector);
        client.submitUpdate(older, witness);
    }

    function _committeeWitness()
        private pure returns (EthereumBeaconLightClient.CommitteeWitness memory witness, bytes memory bits)
    {
        bytes memory compressed = new bytes(512 * 48);
        bits = new bytes(64);
        bytes memory participants = new bytes(342 * 128);
        bytes memory key = COMPRESSED_G1;
        bytes memory point = G1;
        for (uint256 i; i < 512; ++i) {
            assembly ("memory-safe") {
                mcopy(add(add(compressed, 0x20), mul(i, 48)), add(key, 0x20), 48)
            }
            if (i < 342) {
                bits[i >> 3] = bytes1(uint8(bits[i >> 3]) | uint8(1 << (i & 7)));
                assembly ("memory-safe") {
                    mcopy(add(add(participants, 0x20), mul(i, 128)), add(point, 0x20), 128)
                }
            }
        }
        witness = EthereumBeaconLightClient.CommitteeWitness(compressed, key, participants);
    }

    function _update(uint64 finalizedSlot, uint64 attestedSlot, uint64 signatureSlot, bytes32 nextRoot, bytes memory bits)
        private view returns (EthereumBeaconLightClient.Update memory update)
    {
        bytes32 executionHash = keccak256(abi.encode(finalizedSlot));
        (bytes32 bodyRoot, bytes32[] memory executionBranch) = _zeroBranch(executionHash, 812, 9);
        EthereumBeaconSsz.BeaconHeader memory finalized = EthereumBeaconSsz.BeaconHeader(
            finalizedSlot, 1, bytes32(uint256(3)), bytes32(uint256(4)), bodyRoot
        );
        (bytes32 stateRoot, bytes32[] memory finalityBranch, bytes32[] memory nextBranch) =
            _attestedBranches(harness.beaconRoot(finalized), nextRoot);
        EthereumBeaconSsz.BeaconHeader memory attested = EthereumBeaconSsz.BeaconHeader(
            attestedSlot, 1, bytes32(uint256(5)), stateRoot, bytes32(uint256(6))
        );
        if (nextRoot == bytes32(0)) nextBranch = new bytes32[](0);
        update = EthereumBeaconLightClient.Update(
            attested, finalized, finalityBranch, executionHash, executionBranch,
            nextRoot, nextBranch, bits, bytes.concat(new bytes(255), hex"01"), signatureSlot
        );
    }

    function _attestedBranches(bytes32 finalizedRoot, bytes32 nextRoot)
        private pure returns (bytes32 stateRoot, bytes32[] memory finalityBranch, bytes32[] memory nextBranch)
    {
        bytes32[64] memory level;
        level[20] = sha256(abi.encodePacked(bytes32(0), finalizedRoot));
        level[23] = nextRoot;
        finalityBranch = new bytes32[](7);
        nextBranch = new bytes32[](6);
        uint256 finalityIndex = 20;
        uint256 nextIndex = 23;
        uint256 width = 64;
        for (uint256 depth; depth < 6; ++depth) {
            finalityBranch[depth + 1] = level[finalityIndex ^ 1];
            nextBranch[depth] = level[nextIndex ^ 1];
            for (uint256 i; i < width / 2; ++i) {
                level[i] = sha256(abi.encodePacked(level[2 * i], level[2 * i + 1]));
            }
            finalityIndex >>= 1;
            nextIndex >>= 1;
            width >>= 1;
        }
        stateRoot = level[0];
    }

    function _branch(bytes32 leaf, uint256 index) private pure returns (bytes32 root, bytes32[] memory siblings) {
        siblings = new bytes32[](6);
        root = leaf;
        for (uint256 i; i < 6; ++i) {
            root = index & 1 == 0 ? sha256(abi.encodePacked(root, bytes32(0)))
                : sha256(abi.encodePacked(bytes32(0), root));
            index >>= 1;
        }
    }

    function testBlsPrecompilesVerifySupermajoritySignature() public {
        (bool available, bytes memory mapped) = address(0x11).staticcall(new bytes(128));
        assertTrue(available);
        assertEq(mapped.length, 256);
        bytes memory compressed = new bytes(512 * 48);
        bytes memory bitmap = new bytes(64);
        bytes memory participants = new bytes(342 * 128);
        bytes memory compressedKey = COMPRESSED_G1;
        bytes memory pointKey = G1;
        for (uint256 i; i < 512; ++i) {
            assembly ("memory-safe") {
                mcopy(add(add(compressed, 0x20), mul(i, 48)), add(compressedKey, 0x20), 48)
            }
            if (i < 342) {
                bitmap[i >> 3] = bytes1(uint8(bitmap[i >> 3]) | uint8(1 << (i & 7)));
                assembly ("memory-safe") {
                    mcopy(add(add(participants, 0x20), mul(i, 128)), add(pointKey, 0x20), 128)
                }
            }
        }
        bytes32 message = keccak256("beacon-signing-root");
        bytes memory point = harness.hashToG2(message);
        // Noble BLS12-381 vectors use the Ethereum POP DST and aggregate secret 342.
        assertEq(point, hex"000000000000000000000000000000000913df2675883e02d34c9738c7960a4a34bb6276d9ae9e0b38bfc4a8a8aa032497ee310e25af39b634dea49b5dff71bf"
            hex"00000000000000000000000000000000045df28930c3a612e0108dbce0cee0ec1a9d0dd133b9f7ff9e4eb7b2ebb95589fb7d624f1943fb90c785cc0016c9cf01"
            hex"000000000000000000000000000000001214027c6ab83ec55f7261971235f55c2c7de0dca997c0860ac2ffa43f665759e9fce001a00f2be856f74488c3cb0f7b"
            hex"000000000000000000000000000000000f9341d69211430158309ec58b47e1b6413335539507812c4db2a20a84e81a6b88ca747544fbeed58f2d2cb07900cb84");
        bytes memory signature = hex"0000000000000000000000000000000004344aca96981da2a6b6edf1fdb83d5f9bdef74a4553baed4dcbb334ebe27ec23f5a218a62106483d2f3adc9d3b7ad63"
            hex"0000000000000000000000000000000009a3b2a97dbf3a4c01c4210c863085a28e18bfea37449c98d35be78d26c753e02a3304b3ea70191b82da0f41cc7acdbe"
            hex"000000000000000000000000000000000398fb4f52810a01da2ddcf59830fbbe2c9356ae3e6c95b9a2f2bbb274ad3c6800d593062a74caef210ce23ac891a49f"
            hex"0000000000000000000000000000000010ca3e4ea91ff5db3764ac941a20414ce2672f7bf26e68ff2e4efbee2341a944286d43b624bc05b2de82f3f6adb4f83e";
        assertTrue(harness.fastAggregateVerify(message, bitmap, compressed, participants, signature));
        assertFalse(harness.fastAggregateVerify(keccak256("other"), bitmap, compressed, participants, signature));
        bitmap[0] = bytes1(0xfe);
        assertFalse(harness.fastAggregateVerify(message, bitmap, compressed, participants, signature));
    }
}
