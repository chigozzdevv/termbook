// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMonadStakingEpoch {
    function getEpoch() external returns (uint64 epoch, bool inEpochDelayPeriod);

    function getSnapshotValidatorSet(uint32 startIndex)
        external
        returns (bool isDone, uint32 nextIndex, uint64[] memory valIds);

    function getValidator(uint64 validatorId)
        external
        returns (
            address authAddress,
            uint64 flags,
            uint256 stake,
            uint256 accRewardPerToken,
            uint256 commission,
            uint256 unclaimedRewards,
            uint256 consensusStake,
            uint256 consensusCommission,
            uint256 snapshotStake,
            uint256 snapshotCommission,
            bytes memory secpPubkey,
            bytes memory blsPubkey
        );
}

contract MonadEpochCommitter {
    address public constant STAKING = address(0x1000);
    uint256 public constant MAX_VALIDATORS = 200;

    mapping(uint64 => bytes32) public validatorSetHash;

    error Invalid();

    event ValidatorSetCommitted(uint64 indexed epoch, bytes32 indexed validatorSetHash);

    function commitNextEpoch() external returns (bytes32 setHash) {
        (uint64 currentEpoch, bool inDelay) = IMonadStakingEpoch(STAKING).getEpoch();
        if (!inDelay || currentEpoch == 0 || currentEpoch == type(uint64).max) revert Invalid();
        uint64 nextEpoch = currentEpoch + 1;
        if (validatorSetHash[nextEpoch] != bytes32(0)) revert Invalid();

        uint64[] memory ids = new uint64[](MAX_VALIDATORS);
        uint32 cursor;
        uint256 count;
        bool done;
        for (uint256 page; page < 3 && !done; ++page) {
            (bool isDone, uint32 nextIndex, uint64[] memory pageIds) =
                IMonadStakingEpoch(STAKING).getSnapshotValidatorSet(cursor);
            if (pageIds.length == 0 || count + pageIds.length > MAX_VALIDATORS || nextIndex != cursor + pageIds.length) revert Invalid();
            for (uint256 i; i < pageIds.length; ++i) {
                if (pageIds[i] == 0) revert Invalid();
                ids[count++] = pageIds[i];
            }
            cursor = nextIndex;
            done = isDone;
        }
        if (!done || count == 0) revert Invalid();

        bytes memory compressedKeys = new bytes(count * 48);
        uint256[] memory stakes = new uint256[](count);
        bytes32[] memory keyHashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            (,,,,,,,, uint256 snapshotStake,,, bytes memory blsPubkey) =
                IMonadStakingEpoch(STAKING).getValidator(ids[i]);
            if (snapshotStake == 0 || blsPubkey.length != 48) revert Invalid();
            bytes32 keyHash = keccak256(blsPubkey);
            for (uint256 j; j < i; ++j) {
                if (keyHashes[j] == keyHash) revert Invalid();
            }
            keyHashes[i] = keyHash;
            stakes[i] = snapshotStake;
            for (uint256 j; j < 48; ++j) {
                compressedKeys[i * 48 + j] = blsPubkey[j];
            }
        }

        setHash = keccak256(abi.encode(compressedKeys, stakes));
        validatorSetHash[nextEpoch] = setHash;
        emit ValidatorSetCommitted(nextEpoch, setHash);
    }
}
