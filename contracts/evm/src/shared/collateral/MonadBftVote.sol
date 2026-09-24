// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthereumBeaconBls} from "../../monad/collateral/EthereumBeaconBls.sol";

library MonadBftVote {
    uint256 internal constant MAX_VALIDATORS = 200;
    bytes internal constant VOTE_DOMAIN = hex"0d6d6f6e61642f766f74652f310a";

    function verify(
        bytes32 blockId,
        uint64 round,
        uint64 epoch,
        bytes32 expectedValidatorSetHash,
        bytes calldata signerBits,
        bytes calldata compressedKeys,
        bytes calldata validatorKeys,
        uint256[] calldata stakes,
        bytes calldata signature
    ) internal view returns (bool) {
        uint256 count = stakes.length;
        if (
            blockId == bytes32(0) || round == 0 || epoch == 0 || count == 0 || count > MAX_VALIDATORS
                || validatorKeys.length != count * 128 || compressedKeys.length != count * 48
                || signerBits.length != (count + 7) / 8 || signature.length != 256
                || expectedValidatorSetHash == bytes32(0)
                || keccak256(abi.encode(compressedKeys, stakes)) != expectedValidatorSetHash
        ) return false;

        uint256 totalStake;
        uint256 signedStake;
        uint256 signers;
        bytes32[] memory keyHashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            if (!EthereumBeaconBls.matchesCompressed(compressedKeys, i * 48, validatorKeys, i * 128)) return false;
            bytes32 keyHash = keccak256(compressedKeys[i * 48:(i + 1) * 48]);
            for (uint256 j; j < i; ++j) {
                if (keyHashes[j] == keyHash) return false;
            }
            keyHashes[i] = keyHash;
            uint256 stake = stakes[i];
            if (stake == 0 || stake > type(uint128).max - totalStake) return false;
            totalStake += stake;
            if ((uint256(uint8(signerBits[i >> 3])) & (uint256(1) << (i & 7))) != 0) {
                signedStake += stake;
                ++signers;
            }
        }
        if (signedStake <= totalStake * 2 / 3) return false;
        if (count % 8 != 0 && uint8(signerBits[signerBits.length - 1]) >> (count % 8) != 0) return false;

        bytes memory points = new bytes(signers * 160);
        uint256 participant;
        for (uint256 i; i < count; ++i) {
            if ((uint256(uint8(signerBits[i >> 3])) & (uint256(1) << (i & 7))) == 0) continue;
            assembly ("memory-safe") {
                let target := add(add(points, 0x20), mul(participant, 160))
                calldatacopy(target, add(validatorKeys.offset, mul(i, 128)), 128)
                mstore(add(target, 128), 1)
            }
            ++participant;
        }
        (bool aggregated, bytes memory aggregateKey) = address(0x0c).staticcall(points);
        return
            aggregated && EthereumBeaconBls.verifyAggregate(voteMessage(blockId, round, epoch), aggregateKey, signature);
    }

    function voteMessage(bytes32 blockId, uint64 round, uint64 epoch) internal pure returns (bytes memory) {
        bytes memory payload = bytes.concat(hex"a0", blockId, _rlpUint(round), _rlpUint(epoch));
        return bytes.concat(VOTE_DOMAIN, bytes1(uint8(0xc0 + payload.length)), payload);
    }

    function _rlpUint(uint64 value) private pure returns (bytes memory encoded) {
        if (value == 0) return abi.encodePacked(hex"80");
        if (value < 128) return abi.encodePacked(bytes1(uint8(value)));
        uint256 length;
        for (uint64 remaining = value; remaining != 0; remaining >>= 8) {
            ++length;
        }
        encoded = new bytes(length + 1);
        encoded[0] = bytes1(uint8(0x80 + length));
        for (uint256 i; i < length; ++i) {
            encoded[length - i] = bytes1(uint8(value));
            value >>= 8;
        }
    }
}
