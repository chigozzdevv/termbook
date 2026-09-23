// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library EthereumBeaconSsz {
    uint256 internal constant COMMITTEE_SIZE = 512;
    uint256 internal constant PUBKEY_BYTES = 48;
    uint256 internal constant EXECUTION_BLOCK_HASH_GINDEX = 812;
    uint256 internal constant BLOCK_ROOTS_GINDEX = 69;
    uint256 internal constant HISTORICAL_ROOTS_LENGTH = 8192;

    struct BeaconHeader {
        uint64 slot;
        uint64 proposerIndex;
        bytes32 parentRoot;
        bytes32 stateRoot;
        bytes32 bodyRoot;
    }

    error InvalidSszProof();

    function beaconRoot(BeaconHeader memory header) internal pure returns (bytes32) {
        bytes32 slot = _uint64Root(header.slot);
        bytes32 proposer = _uint64Root(header.proposerIndex);
        bytes32 left = sha256(abi.encodePacked(sha256(abi.encodePacked(slot, proposer)),
            sha256(abi.encodePacked(header.parentRoot, header.stateRoot))));
        bytes32 right = sha256(abi.encodePacked(
            sha256(abi.encodePacked(header.bodyRoot, bytes32(0))),
            sha256(abi.encodePacked(bytes32(0), bytes32(0)))
        ));
        return sha256(abi.encodePacked(left, right));
    }

    function verifyBranch(bytes32 leaf, bytes32[] memory branch, uint256 gindex, bytes32 root)
        internal
        pure
        returns (bool)
    {
        if (gindex < 2 || root == bytes32(0)) return false;
        bytes32 value = leaf;
        uint256 index = gindex;
        for (uint256 i; i < branch.length; ++i) {
            if (index < 2) return false;
            value = index & 1 == 0
                ? sha256(abi.encodePacked(value, branch[i]))
                : sha256(abi.encodePacked(branch[i], value));
            index >>= 1;
        }
        return index == 1 && value == root;
    }

    function verifyExecutionBlockHash(bytes32 blockHash, bytes32[] memory branch, bytes32 bodyRoot)
        internal
        pure
        returns (bool)
    {
        return blockHash != bytes32(0) && branch.length == 9
            && verifyBranch(blockHash, branch, EXECUTION_BLOCK_HASH_GINDEX, bodyRoot);
    }

    function verifyHistoricalBlock(
        bytes32 targetRoot,
        uint64 blockSlot,
        uint64 finalizedSlot,
        bytes32[] memory branch,
        bytes32 finalizedStateRoot
    ) internal pure returns (bool) {
        if (
            targetRoot == bytes32(0) || blockSlot >= finalizedSlot
                || finalizedSlot - blockSlot > HISTORICAL_ROOTS_LENGTH || branch.length != 19
        ) return false;
        uint256 index = BLOCK_ROOTS_GINDEX * HISTORICAL_ROOTS_LENGTH
            + uint256(blockSlot) % HISTORICAL_ROOTS_LENGTH;
        return verifyBranch(targetRoot, branch, index, finalizedStateRoot);
    }

    function committeeRoot(bytes calldata pubkeys, bytes calldata aggregatePubkey)
        internal
        pure
        returns (bytes32)
    {
        if (pubkeys.length != COMMITTEE_SIZE * PUBKEY_BYTES || aggregatePubkey.length != PUBKEY_BYTES) {
            revert InvalidSszProof();
        }
        bytes32[] memory level = new bytes32[](COMMITTEE_SIZE);
        bytes memory padded = new bytes(64);
        for (uint256 i; i < COMMITTEE_SIZE; ++i) {
            assembly ("memory-safe") {
                calldatacopy(add(padded, 0x20), add(pubkeys.offset, mul(i, 48)), 48)
            }
            level[i] = sha256(padded);
        }
        for (uint256 width = COMMITTEE_SIZE; width > 1; width >>= 1) {
            for (uint256 i; i < width / 2; ++i) {
                level[i] = sha256(abi.encodePacked(level[2 * i], level[2 * i + 1]));
            }
        }
        bytes memory aggregatePadded = new bytes(64);
        assembly ("memory-safe") {
            calldatacopy(add(aggregatePadded, 0x20), aggregatePubkey.offset, 48)
        }
        return sha256(abi.encodePacked(level[0], sha256(aggregatePadded)));
    }

    function _uint64Root(uint64 value) private pure returns (bytes32 result) {
        uint256 reversed;
        for (uint256 i; i < 8; ++i) {
            reversed |= uint256((value >> (i * 8)) & 0xff) << ((31 - i) * 8);
        }
        result = bytes32(reversed);
    }
}
