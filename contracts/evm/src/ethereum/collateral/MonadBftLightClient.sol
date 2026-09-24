// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MonadBftHeader} from "../../shared/collateral/MonadBftHeader.sol";
import {MonadBftVote} from "../../shared/collateral/MonadBftVote.sol";
import {EvmReceiptProof} from "../../shared/collateral/EvmReceiptProof.sol";
import {IConsensusLightClient} from "../../shared/collateral/IVerifier.sol";

contract MonadBftLightClient is IConsensusLightClient {
    struct QcProof {
        bytes signerBits;
        bytes compressedKeys;
        bytes validatorKeys;
        uint256[] stakes;
        bytes signature;
    }

    struct FinalizedExecution {
        bytes32 receiptsRoot;
        uint64 timestamp;
        uint64 number;
        uint64 epoch;
    }

    uint256 public immutable chainId;
    uint256 public immutable consensusVersion;
    bytes32 public immutable bootstrapHash;
    uint256 public immutable proofMaxAge;
    uint64 public immutable bootstrapEpoch;
    bytes32 public immutable validatorSetHash;
    address public immutable epochCommitter;
    uint64 public latestEpoch;

    mapping(bytes32 => uint64) public knownSequence;
    mapping(bytes32 => bool) public finalizedConsensus;
    mapping(bytes32 => FinalizedExecution) public execution;
    mapping(uint64 => bytes32) public validatorSetHashOfEpoch;

    error Invalid();

    event ConsensusFinalized(bytes32 indexed blockId, uint64 sequence);
    event ExecutionFinalized(bytes32 indexed blockId, uint64 number, bytes32 receiptsRoot);
    event ConsensusCertified(bytes32 indexed blockId, uint64 sequence);
    event ValidatorSetLearned(uint64 indexed epoch, bytes32 indexed setHash);

    constructor(
        uint256 chainId_,
        uint256 consensusVersion_,
        uint256 proofMaxAge_,
        bytes32 bootstrapHash_,
        uint64 bootstrapSequence_,
        uint64 bootstrapEpoch_,
        bytes32 validatorSetHash_,
        address epochCommitter_
    ) {
        if (
            chainId_ == 0 || consensusVersion_ == 0 || proofMaxAge_ == 0 || validatorSetHash_ == bytes32(0)
                || bootstrapHash_ == bytes32(0) || bootstrapSequence_ == 0 || bootstrapSequence_ == type(uint64).max
                || bootstrapEpoch_ == 0 || epochCommitter_ == address(0)
        ) revert Invalid();
        chainId = chainId_;
        consensusVersion = consensusVersion_;
        proofMaxAge = proofMaxAge_;
        bootstrapHash = bootstrapHash_;
        bootstrapEpoch = bootstrapEpoch_;
        validatorSetHash = validatorSetHash_;
        epochCommitter = epochCommitter_;
        latestEpoch = bootstrapEpoch_;
        validatorSetHashOfEpoch[bootstrapEpoch_] = validatorSetHash_;
        knownSequence[bootstrapHash_] = bootstrapSequence_;
    }

    function submitValidatorSet(
        uint64 epoch,
        bytes32 setHash,
        bytes calldata executionHeader,
        bytes calldata receiptProof
    ) external {
        FinalizedExecution memory result = execution[keccak256(executionHeader)];
        if (
            latestEpoch == type(uint64).max || epoch != latestEpoch + 1 || setHash == bytes32(0)
                || result.receiptsRoot == bytes32(0) || result.epoch != latestEpoch
                || result.timestamp > block.timestamp || block.timestamp - result.timestamp > proofMaxAge
                || receiptProof.length == 0 || receiptProof.length > 160_000
                || !EvmReceiptProof.verifyValidatorSet(
                    result.receiptsRoot, receiptProof, epochCommitter, epoch, setHash
                )
        ) revert Invalid();
        validatorSetHashOfEpoch[epoch] = setHash;
        latestEpoch = epoch;
        emit ValidatorSetLearned(epoch, setHash);
    }

    function submitFinalized(
        bytes calldata parentHeader,
        bytes calldata childHeader,
        QcProof calldata parentQc,
        QcProof calldata childQc
    ) external {
        _submit(parentHeader, childHeader, parentQc, childQc, true);
    }

    function submitCertified(
        bytes calldata parentHeader,
        bytes calldata childHeader,
        QcProof calldata parentQc,
        QcProof calldata childQc
    ) external {
        _submit(parentHeader, childHeader, parentQc, childQc, false);
    }

    function _submit(
        bytes calldata parentHeader,
        bytes calldata childHeader,
        QcProof calldata parentQc,
        QcProof calldata childQc,
        bool finalize
    ) private {
        MonadBftHeader.Header memory parent = MonadBftHeader.read(parentHeader);
        MonadBftHeader.Header memory child = MonadBftHeader.read(childHeader);
        if (
            knownSequence[parent.id] != parent.sequence || (finalize && finalizedConsensus[parent.id])
                || parent.epoch < bootstrapEpoch || child.epoch < parent.epoch || child.epoch > parent.epoch + 1
                || child.epoch > latestEpoch || validatorSetHashOfEpoch[parent.epoch] == bytes32(0)
                || validatorSetHashOfEpoch[child.epoch] == bytes32(0) || parent.sequence == type(uint64).max
                || child.sequence != parent.sequence + 1 || parent.round == type(uint64).max
                || child.round <= parent.round || (finalize && child.round != parent.round + 1)
                || child.timestampNs <= parent.timestampNs || child.qcId != parent.id || child.qcRound != parent.round
                || child.qcEpoch != parent.epoch
        ) revert Invalid();
        if (
            !MonadBftVote.verify(
                    parent.id,
                    parent.round,
                    parent.epoch,
                    validatorSetHashOfEpoch[parent.epoch],
                    parentQc.signerBits,
                    parentQc.compressedKeys,
                    parentQc.validatorKeys,
                    parentQc.stakes,
                    parentQc.signature
                )
                || !MonadBftVote.verify(
                    child.id,
                    child.round,
                    child.epoch,
                    validatorSetHashOfEpoch[child.epoch],
                    childQc.signerBits,
                    childQc.compressedKeys,
                    childQc.validatorKeys,
                    childQc.stakes,
                    childQc.signature
                )
        ) revert Invalid();

        knownSequence[child.id] = child.sequence;
        emit ConsensusCertified(child.id, child.sequence);
        if (!finalize) return;
        finalizedConsensus[parent.id] = true;
        emit ConsensusFinalized(parent.id, parent.sequence);
        uint256 count = MonadBftHeader.executionCount(parentHeader);
        for (uint256 i; i < count; ++i) {
            MonadBftHeader.Execution memory result = MonadBftHeader.execution(parentHeader, i);
            if (
                result.timestamp > block.timestamp || block.timestamp - result.timestamp > proofMaxAge
                    || execution[result.id].receiptsRoot != bytes32(0)
            ) revert Invalid();
            execution[result.id] =
                FinalizedExecution(result.receiptsRoot, result.timestamp, result.number, parent.epoch);
            emit ExecutionFinalized(result.id, result.number, result.receiptsRoot);
        }
    }

    function finalizedExecutionReceiptsRoot(bytes calldata header) external view returns (bytes32) {
        return execution[keccak256(header)].receiptsRoot;
    }

    function headerTimestamp(bytes calldata header) external view returns (uint256) {
        return execution[keccak256(header)].timestamp;
    }

    function verifyFinality(bytes calldata header) external view returns (bool) {
        FinalizedExecution memory result = execution[keccak256(header)];
        return result.receiptsRoot != bytes32(0) && result.timestamp <= block.timestamp
            && block.timestamp - result.timestamp <= proofMaxAge;
    }

    function headerRoot(bytes calldata header) external view returns (bytes32) {
        bytes32 id = keccak256(header);
        return execution[id].receiptsRoot != bytes32(0) ? id : bytes32(0);
    }

    function verifyInclusion(bytes calldata, bytes32) external pure returns (bool) {
        return false;
    }

    function proofLeaf(bytes calldata) external pure returns (bytes32) {
        return bytes32(0);
    }

    function verifyEvent(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) {
        return false;
    }

    function verifyLock(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) {
        return false;
    }
}
