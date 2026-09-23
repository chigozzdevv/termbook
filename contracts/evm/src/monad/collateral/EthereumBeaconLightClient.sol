// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IConsensusLightClient} from "../../shared/collateral/IVerifier.sol";
import {EthereumBeaconSsz} from "./EthereumBeaconSsz.sol";
import {EthereumBeaconBls} from "./EthereumBeaconBls.sol";
import {EthereumBeaconPeriods} from "./EthereumBeaconPeriods.sol";

contract EthereumBeaconLightClient is IConsensusLightClient {
    uint256 public constant chainId = 1;
    uint256 public constant consensusVersion = 1;
    uint256 public constant proofMaxAge = 1 days;
    uint256 public constant weakSubjectivityWindow = 14 days;
    uint256 public constant checkpointRecoveryDelay = 2 days;
    uint256 public constant genesisTime = 1_606_824_023;
    uint256 public constant fuluStartSlot = 411_392 * 32;
    bytes32 public constant genesisValidatorsRoot =
        0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95;

    struct FinalizedExecution {
        bytes32 blockHash;
        uint64 slot;
    }

    struct FinalizedCheckpoint {
        bytes32 stateRoot;
        uint64 slot;
    }

    struct Update {
        EthereumBeaconSsz.BeaconHeader attested;
        EthereumBeaconSsz.BeaconHeader finalized;
        bytes32[] finalityBranch;
        bytes32 executionBlockHash;
        bytes32[] executionBranch;
        bytes32 nextCommitteeRoot;
        bytes32[] nextCommitteeBranch;
        bytes syncCommitteeBits;
        bytes signature;
        uint64 signatureSlot;
    }

    struct CommitteeWitness {
        bytes compressedPubkeys;
        bytes aggregatePubkey;
        bytes uncompressedParticipants;
    }

    struct PendingCheckpoint {
        uint64 slot;
        uint64 executeAfter;
        uint64 generation;
    }

    bytes32 public immutable bootstrapHash;
    address public immutable recoveryGovernance;
    uint64 public checkpointGeneration;
    uint64 public finalizedSlot;
    bytes32 public finalizedBeaconRoot;
    bytes32 public finalizedStateRoot;
    bytes32 public currentCommitteeRoot;
    bytes32 public nextCommitteeRoot;
    mapping(bytes32 => FinalizedExecution) public finalizedExecution;
    mapping(bytes32 => FinalizedCheckpoint) public finalizedCheckpoints;
    mapping(bytes32 => uint64) public executionGeneration;
    mapping(bytes32 => uint64) public finalizedCheckpointGeneration;
    mapping(bytes32 => PendingCheckpoint) public pendingCheckpoints;

    error InvalidBootstrap();
    error InvalidUpdate();
    error Unauthorized();
    error NotReady();

    event Finalized(bytes32 indexed beaconRoot, bytes32 indexed executionBlockHash, uint64 slot);
    event CommitteeRotated(bytes32 indexed currentRoot, bytes32 indexed nextRoot);
    event CommitteeLearned(bytes32 indexed nextRoot);
    event CheckpointQueued(bytes32 indexed beaconRoot, uint64 slot, uint64 executeAfter);
    event CheckpointCancelled(bytes32 indexed beaconRoot);
    event CheckpointRecovered(bytes32 indexed beaconRoot, bytes32 indexed executionBlockHash, uint64 slot);

    constructor(
        bytes32 trustedBeaconRoot,
        EthereumBeaconSsz.BeaconHeader memory checkpoint,
        bytes32 committeeRoot,
        bytes32[] memory committeeBranch,
        address recoveryGovernance_
    ) {
        if (
            recoveryGovernance_.code.length == 0 || trustedBeaconRoot == bytes32(0)
                || committeeRoot == bytes32(0) || checkpoint.slot < fuluStartSlot
                || checkpoint.slot > _currentSlot() || committeeBranch.length != 6
                || EthereumBeaconSsz.beaconRoot(checkpoint) != trustedBeaconRoot
                || !EthereumBeaconSsz.verifyBranch(committeeRoot, committeeBranch, 86, checkpoint.stateRoot)
                || block.timestamp - _slotTime(checkpoint.slot) > weakSubjectivityWindow
        ) revert InvalidBootstrap();
        bootstrapHash = trustedBeaconRoot;
        recoveryGovernance = recoveryGovernance_;
        checkpointGeneration = 1;
        finalizedSlot = checkpoint.slot;
        finalizedBeaconRoot = trustedBeaconRoot;
        finalizedStateRoot = checkpoint.stateRoot;
        currentCommitteeRoot = committeeRoot;
        finalizedCheckpoints[trustedBeaconRoot] = FinalizedCheckpoint(checkpoint.stateRoot, checkpoint.slot);
        finalizedCheckpointGeneration[trustedBeaconRoot] = 1;
    }

    function queueCheckpoint(bytes32 trustedBeaconRoot, uint64 slot) external {
        if (msg.sender != recoveryGovernance) revert Unauthorized();
        if (
            trustedBeaconRoot == bytes32(0) || slot <= finalizedSlot || slot < fuluStartSlot
                || slot > _currentSlot() || pendingCheckpoints[trustedBeaconRoot].executeAfter != 0
                || block.timestamp - _slotTime(slot) > weakSubjectivityWindow - checkpointRecoveryDelay
        ) revert InvalidUpdate();
        uint64 executeAfter = uint64(block.timestamp + checkpointRecoveryDelay);
        pendingCheckpoints[trustedBeaconRoot] = PendingCheckpoint(slot, executeAfter, checkpointGeneration);
        emit CheckpointQueued(trustedBeaconRoot, slot, executeAfter);
    }

    function cancelCheckpoint(bytes32 trustedBeaconRoot) external {
        if (msg.sender != recoveryGovernance) revert Unauthorized();
        if (pendingCheckpoints[trustedBeaconRoot].executeAfter == 0) revert InvalidUpdate();
        delete pendingCheckpoints[trustedBeaconRoot];
        emit CheckpointCancelled(trustedBeaconRoot);
    }

    function recoverCheckpoint(
        bytes32 trustedBeaconRoot,
        EthereumBeaconSsz.BeaconHeader calldata checkpoint,
        bytes32 committeeRoot,
        bytes32[] calldata committeeBranch,
        bytes32 executionBlockHash,
        bytes32[] calldata executionBranch
    ) external {
        PendingCheckpoint memory pending = pendingCheckpoints[trustedBeaconRoot];
        if (pending.executeAfter == 0 || block.timestamp < pending.executeAfter) revert NotReady();
        if (
            pending.generation != checkpointGeneration
                || block.timestamp - _slotTime(finalizedSlot) <= weakSubjectivityWindow
                || checkpoint.slot != pending.slot || checkpoint.slot <= finalizedSlot
                || checkpoint.slot > _currentSlot() || checkpoint.slot < fuluStartSlot
                || block.timestamp - _slotTime(checkpoint.slot) > weakSubjectivityWindow
                || trustedBeaconRoot == bytes32(0) || committeeRoot == bytes32(0)
                || EthereumBeaconSsz.beaconRoot(checkpoint) != trustedBeaconRoot
                || committeeBranch.length != 6
                || !EthereumBeaconSsz.verifyBranch(committeeRoot, committeeBranch, 86, checkpoint.stateRoot)
                || !EthereumBeaconSsz.verifyExecutionBlockHash(
                    executionBlockHash, executionBranch, checkpoint.bodyRoot
                )
        ) revert InvalidUpdate();
        delete pendingCheckpoints[trustedBeaconRoot];
        checkpointGeneration += 1;
        finalizedSlot = checkpoint.slot;
        finalizedBeaconRoot = trustedBeaconRoot;
        finalizedStateRoot = checkpoint.stateRoot;
        currentCommitteeRoot = committeeRoot;
        nextCommitteeRoot = bytes32(0);
        finalizedExecution[trustedBeaconRoot] = FinalizedExecution(executionBlockHash, checkpoint.slot);
        executionGeneration[trustedBeaconRoot] = checkpointGeneration;
        finalizedCheckpoints[trustedBeaconRoot] = FinalizedCheckpoint(checkpoint.stateRoot, checkpoint.slot);
        finalizedCheckpointGeneration[trustedBeaconRoot] = checkpointGeneration;
        emit CheckpointRecovered(trustedBeaconRoot, executionBlockHash, checkpoint.slot);
    }

    function submitUpdate(Update calldata update, CommitteeWitness calldata witness) external {
        uint256 nowSlot = _currentSlot();
        uint256 storePeriod = uint256(finalizedSlot) / 8192;
        uint256 signaturePeriod = uint256(update.signatureSlot) / 8192;
        uint256 finalizedPeriod = uint256(update.finalized.slot) / 8192;
        uint256 attestedPeriod = uint256(update.attested.slot) / 8192;
        bool committeeOnly = update.finalized.slot <= finalizedSlot;
        if (
            update.attested.slot < fuluStartSlot || update.finalized.slot < fuluStartSlot
                || update.finalized.slot > update.attested.slot || update.attested.slot >= update.signatureSlot
                || update.signatureSlot > nowSlot || signaturePeriod < storePeriod || signaturePeriod > storePeriod + 1
                || block.timestamp - _slotTime(finalizedSlot) > weakSubjectivityWindow
                || (signaturePeriod == storePeriod + 1 && nextCommitteeRoot == bytes32(0))
                || (committeeOnly && (
                    nextCommitteeRoot != bytes32(0) || update.nextCommitteeRoot == bytes32(0)
                        || attestedPeriod != storePeriod || finalizedPeriod != storePeriod
                        || signaturePeriod != storePeriod
                ))
                || (!committeeOnly && (finalizedPeriod < storePeriod || finalizedPeriod > storePeriod + 1))
        ) revert InvalidUpdate();

        bytes32 attestedRoot = EthereumBeaconSsz.beaconRoot(update.attested);
        bytes32 newFinalizedRoot = EthereumBeaconSsz.beaconRoot(update.finalized);
        if (
            update.finalityBranch.length != 7
                || !EthereumBeaconSsz.verifyBranch(
                    newFinalizedRoot, update.finalityBranch, 169, update.attested.stateRoot
                )
                || !EthereumBeaconSsz.verifyExecutionBlockHash(
                    update.executionBlockHash, update.executionBranch, update.finalized.bodyRoot
                )
        ) revert InvalidUpdate();

        bytes32 signerCommittee = signaturePeriod == storePeriod ? currentCommitteeRoot : nextCommitteeRoot;
        if (
            EthereumBeaconSsz.committeeRoot(witness.compressedPubkeys, witness.aggregatePubkey)
                != signerCommittee
                || !EthereumBeaconBls.fastAggregateVerify(
                    _signingRoot(attestedRoot), update.syncCommitteeBits, witness.compressedPubkeys,
                    witness.uncompressedParticipants, update.signature
                )
        ) revert InvalidUpdate();

        if (update.nextCommitteeRoot == bytes32(0)) {
            if (update.nextCommitteeBranch.length != 0) revert InvalidUpdate();
        } else if (
            update.nextCommitteeBranch.length != 6
                || !EthereumBeaconSsz.verifyBranch(
                    update.nextCommitteeRoot, update.nextCommitteeBranch, 87, update.attested.stateRoot
                )
        ) revert InvalidUpdate();
        if (committeeOnly) {
            nextCommitteeRoot = update.nextCommitteeRoot;
            emit CommitteeLearned(nextCommitteeRoot);
            return;
        }
        (bytes32 current, bytes32 next, bool rotated, bool valid) = EthereumBeaconPeriods.advance(
            storePeriod, finalizedPeriod, attestedPeriod,
            currentCommitteeRoot, nextCommitteeRoot, update.nextCommitteeRoot
        );
        if (!valid) revert InvalidUpdate();
        currentCommitteeRoot = current;
        nextCommitteeRoot = next;
        if (rotated) {
            emit CommitteeRotated(currentCommitteeRoot, nextCommitteeRoot);
        }
        finalizedSlot = update.finalized.slot;
        finalizedBeaconRoot = newFinalizedRoot;
        finalizedStateRoot = update.finalized.stateRoot;
        finalizedExecution[newFinalizedRoot] = FinalizedExecution(update.executionBlockHash, update.finalized.slot);
        executionGeneration[newFinalizedRoot] = checkpointGeneration;
        finalizedCheckpoints[newFinalizedRoot] = FinalizedCheckpoint(update.finalized.stateRoot, update.finalized.slot);
        finalizedCheckpointGeneration[newFinalizedRoot] = checkpointGeneration;
        emit Finalized(newFinalizedRoot, update.executionBlockHash, update.finalized.slot);
    }

    function submitFinalizedBlock(
        bytes32 checkpointRoot,
        EthereumBeaconSsz.BeaconHeader calldata beacon,
        bytes32[] calldata blockRootBranch,
        bytes32 executionBlockHash,
        bytes32[] calldata executionBranch
    ) external {
        bytes32 beaconRoot = EthereumBeaconSsz.beaconRoot(beacon);
        FinalizedCheckpoint memory checkpoint = finalizedCheckpoints[checkpointRoot];
        if (
            beacon.slot < fuluStartSlot || checkpoint.stateRoot == bytes32(0)
                || finalizedCheckpointGeneration[checkpointRoot] != checkpointGeneration
                || block.timestamp - _slotTime(finalizedSlot) > weakSubjectivityWindow
                || !EthereumBeaconSsz.verifyHistoricalBlock(
                    beaconRoot, beacon.slot, checkpoint.slot, blockRootBranch, checkpoint.stateRoot
                ) || !EthereumBeaconSsz.verifyExecutionBlockHash(
                    executionBlockHash, executionBranch, beacon.bodyRoot
                )
        ) revert InvalidUpdate();
        finalizedExecution[beaconRoot] = FinalizedExecution(executionBlockHash, beacon.slot);
        executionGeneration[beaconRoot] = checkpointGeneration;
        emit Finalized(beaconRoot, executionBlockHash, beacon.slot);
    }

    function headerTimestamp(bytes calldata header) external view returns (uint256) {
        (, bytes32 root) = _reference(header);
        FinalizedExecution memory execution = finalizedExecution[root];
        return executionGeneration[root] != checkpointGeneration || execution.blockHash == bytes32(0)
            ? 0 : _slotTime(execution.slot);
    }

    function verifyFinality(bytes calldata header) external view returns (bool) {
        (bytes memory raw, bytes32 root) = _reference(header);
        FinalizedExecution memory execution = finalizedExecution[root];
        uint256 timestamp = _slotTime(execution.slot);
        return executionGeneration[root] == checkpointGeneration && execution.blockHash != bytes32(0)
            && keccak256(raw) == execution.blockHash
            && timestamp <= block.timestamp && block.timestamp - timestamp <= proofMaxAge;
    }

    function verifyHistoricalFinality(bytes calldata header) external view returns (bool) {
        (bytes memory raw, bytes32 root) = _reference(header);
        FinalizedExecution memory execution = finalizedExecution[root];
        uint256 timestamp = _slotTime(execution.slot);
        return executionGeneration[root] == checkpointGeneration && execution.blockHash != bytes32(0)
            && keccak256(raw) == execution.blockHash
            && timestamp <= block.timestamp && _slotTime(finalizedSlot) <= block.timestamp
            && block.timestamp - _slotTime(finalizedSlot) <= weakSubjectivityWindow;
    }

    function finalizedExecutionBlockHash(bytes calldata header) external view returns (bytes32) {
        (, bytes32 root) = _reference(header);
        return executionGeneration[root] == checkpointGeneration ? finalizedExecution[root].blockHash : bytes32(0);
    }

    function headerRoot(bytes calldata header) external view returns (bytes32 root) {
        (, root) = _reference(header);
        if (executionGeneration[root] != checkpointGeneration || finalizedExecution[root].blockHash == bytes32(0)) {
            revert InvalidUpdate();
        }
    }

    function verifyInclusion(bytes calldata, bytes32) external pure returns (bool) { return false; }
    function proofLeaf(bytes calldata) external pure returns (bytes32) { return bytes32(0); }
    function verifyEvent(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) { return false; }
    function verifyLock(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) { return false; }

    function _reference(bytes calldata header) private pure returns (bytes memory raw, bytes32 root) {
        bytes memory proofRef;
        (raw, proofRef) = abi.decode(header, (bytes, bytes));
        root = abi.decode(proofRef, (bytes32));
    }

    function _signingRoot(bytes32 attestedRoot) private pure returns (bytes32) {
        bytes32 forkDataRoot = sha256(abi.encodePacked(bytes4(0x06000000), bytes28(0), genesisValidatorsRoot));
        bytes32 domain = bytes32(bytes.concat(bytes4(0x07000000), bytes28(forkDataRoot)));
        return sha256(abi.encodePacked(attestedRoot, domain));
    }

    function _currentSlot() private view returns (uint256) {
        if (block.timestamp < genesisTime) revert InvalidBootstrap();
        return (block.timestamp - genesisTime) / 12;
    }

    function _slotTime(uint256 slot) private pure returns (uint256) {
        return genesisTime + slot * 12;
    }
}
