// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library EthereumBeaconBls {
    bytes internal constant DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";
    bytes internal constant FIELD_MODULUS =
        hex"1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab";
    uint256 internal constant HALF_FIELD_HEAD =
        0x000000000000000000000000000000000d0088f51cbff34d258dd3db21a5d66b;
    uint256 internal constant HALF_FIELD_TAIL =
        0xb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd555;
    bytes internal constant NEG_G1_GENERATOR = hex"00000000000000000000000000000000"
        hex"17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
        hex"00000000000000000000000000000000"
        hex"114d1d6855d545a8aa7d76c8cf2e21f267816aef1db507c96655b9d5caac42364e6f38ba0ecb751bad54dcd6b939c2ca";

    function fastAggregateVerify(
        bytes32 signingRoot,
        bytes calldata bits,
        bytes calldata compressedPubkeys,
        bytes calldata uncompressedParticipants,
        bytes calldata signature
    ) internal view returns (bool) {
        if (bits.length != 64 || compressedPubkeys.length != 512 * 48 || signature.length != 256) return false;
        uint256 participants = _countBits(bits);
        if (participants < 342 || uncompressedParticipants.length != participants * 128) return false;
        bytes memory msm = new bytes(participants * 160);
        uint256 participantIndex;
        for (uint256 i; i < 512; ++i) {
            if ((uint8(bits[i >> 3]) & (1 << (i & 7))) == 0) continue;
            uint256 pointOffset = participantIndex * 128;
            if (!_matchesCompressed(compressedPubkeys, i * 48, uncompressedParticipants, pointOffset)) return false;
            uint256 target = participantIndex * 160;
            assembly ("memory-safe") {
                calldatacopy(add(add(msm, 0x20), target), add(uncompressedParticipants.offset, pointOffset), 128)
            }
            msm[target + 159] = bytes1(uint8(1));
            ++participantIndex;
        }
        (bool aggregated, bytes memory aggregateKey) = address(0x0c).staticcall(msm);
        if (!aggregated || aggregateKey.length != 128 || _allZero(aggregateKey)) return false;
        return verifyAggregate(abi.encodePacked(signingRoot), aggregateKey, signature);
    }

    function verifyAggregate(bytes memory message, bytes memory aggregateKey, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        if (aggregateKey.length != 128 || _allZero(aggregateKey) || signature.length != 256) return false;
        bytes memory hashPoint = hashToG2(message);
        if (hashPoint.length != 256) return false;
        bytes memory input = bytes.concat(aggregateKey, hashPoint, NEG_G1_GENERATOR, signature);
        (bool paired, bytes memory output) = address(0x0f).staticcall(input);
        return paired && output.length == 32 && abi.decode(output, (uint256)) == 1;
    }

    function hashToG2(bytes32 message) internal view returns (bytes memory) {
        return hashToG2(abi.encodePacked(message));
    }

    function hashToG2(bytes memory message) internal view returns (bytes memory) {
        bytes32[8] memory blocks;
        bytes memory dst = bytes.concat(DST, bytes1(uint8(DST.length)));
        bytes32 b0 = sha256(bytes.concat(new bytes(64), message, hex"0100", hex"00", dst));
        blocks[0] = sha256(bytes.concat(b0, hex"01", dst));
        for (uint256 i = 1; i < 8; ++i) {
            blocks[i] = sha256(bytes.concat(b0 ^ blocks[i - 1], bytes1(uint8(i + 1)), dst));
        }
        bytes memory u0 = bytes.concat(_reduce(bytes.concat(blocks[0], blocks[1])),
            _reduce(bytes.concat(blocks[2], blocks[3])));
        bytes memory u1 = bytes.concat(_reduce(bytes.concat(blocks[4], blocks[5])),
            _reduce(bytes.concat(blocks[6], blocks[7])));
        (bool mapped0, bytes memory point0) = address(0x11).staticcall(u0);
        (bool mapped1, bytes memory point1) = address(0x11).staticcall(u1);
        if (!mapped0 || !mapped1 || point0.length != 256 || point1.length != 256) return bytes("");
        (bool added, bytes memory result) = address(0x0d).staticcall(bytes.concat(point0, point1));
        return added && result.length == 256 ? result : bytes("");
    }

    function _reduce(bytes memory wide) private view returns (bytes memory result) {
        bytes memory input = abi.encodePacked(uint256(64), uint256(1), uint256(48), wide, hex"01", FIELD_MODULUS);
        (bool success, bytes memory reduced) = address(0x05).staticcall(input);
        if (!success || reduced.length != 48) return bytes("");
        return bytes.concat(bytes16(0), reduced);
    }

    function _matchesCompressed(
        bytes calldata compressed,
        uint256 compressedOffset,
        bytes calldata point,
        uint256 pointOffset
    ) private pure returns (bool) {
        uint256 xHead;
        uint256 xTail;
        uint256 yHead;
        uint256 yTail;
        uint256 compressedHead;
        uint256 compressedTail;
        uint256 xLeading;
        assembly ("memory-safe") {
            xLeading := shr(128, calldataload(add(point.offset, pointOffset)))
            xHead := calldataload(add(add(point.offset, pointOffset), 16))
            xTail := shr(128, calldataload(add(add(point.offset, pointOffset), 48)))
            yHead := calldataload(add(add(point.offset, pointOffset), 64))
            yTail := calldataload(add(add(point.offset, pointOffset), 96))
            compressedHead := calldataload(add(compressed.offset, compressedOffset))
            compressedTail := shr(128, calldataload(add(add(compressed.offset, compressedOffset), 32)))
        }
        if (xLeading != 0 || yHead >> 128 != 0) return false;
        bool largeY = yHead > HALF_FIELD_HEAD || (yHead == HALF_FIELD_HEAD && yTail > HALF_FIELD_TAIL);
        uint256 flags = uint256(largeY ? 0xa0 : 0x80) << 248;
        return compressedHead == (xHead | flags) && compressedTail == xTail;
    }

    function _countBits(bytes calldata bits) private pure returns (uint256 count) {
        for (uint256 i; i < 64; ++i) {
            uint256 value = uint8(bits[i]);
            while (value != 0) {
                value &= value - 1;
                ++count;
            }
        }
    }

    function _allZero(bytes memory value) private pure returns (bool) {
        for (uint256 i; i < value.length; ++i) {
            if (value[i] != bytes1(0)) return false;
        }
        return true;
    }
}
