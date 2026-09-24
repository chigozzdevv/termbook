// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Blake3 {
    uint256 internal constant MAX_INPUT = 16_384;
    uint32 private constant CHUNK_START = 1;
    uint32 private constant CHUNK_END = 2;
    uint32 private constant PARENT = 4;
    uint32 private constant ROOT = 8;

    struct Output {
        uint32[8] cv;
        uint32[16] words;
        uint64 counter;
        uint32 length;
        uint32 flags;
    }

    error InputTooLong();

    function hash(bytes calldata input) internal pure returns (bytes32 digest) {
        if (input.length > MAX_INPUT) revert InputTooLong();
        Output memory root = _output(input, 0, input.length, 0);
        uint32[16] memory words = _compress(root.cv, root.words, root.counter, root.length, root.flags | ROOT);
        bytes memory result = new bytes(32);
        for (uint256 i; i < 8; ++i) {
            uint32 word = words[i];
            for (uint256 j; j < 4; ++j) {
                result[i * 4 + j] = bytes1(uint8(word));
                word >>= 8;
            }
        }
        assembly ("memory-safe") {
            digest := mload(add(result, 0x20))
        }
    }

    function _output(bytes calldata input, uint256 offset, uint256 length, uint64 chunk)
        private
        pure
        returns (Output memory output)
    {
        if (length <= 1024) {
            uint32[8] memory cv = _iv();
            uint256 blocks = length == 0 ? 1 : (length + 63) / 64;
            for (uint256 i; i + 1 < blocks; ++i) {
                uint32[16] memory compressed =
                    _compress(cv, _block(input, offset + i * 64, 64), chunk, 64, i == 0 ? CHUNK_START : 0);
                for (uint256 j; j < 8; ++j) cv[j] = compressed[j];
            }
            uint256 lastLength = length - (blocks - 1) * 64;
            output.cv = cv;
            output.words = _block(input, offset + (blocks - 1) * 64, lastLength);
            output.counter = chunk;
            output.length = uint32(lastLength);
            output.flags = CHUNK_END | (blocks == 1 ? CHUNK_START : 0);
            return output;
        }

        uint256 chunks = (length + 1023) / 1024;
        uint256 leftChunks = 1;
        while (leftChunks * 2 < chunks) leftChunks *= 2;
        uint256 leftLength = leftChunks * 1024;
        uint32[8] memory left = _chainingValue(_output(input, offset, leftLength, chunk));
        uint32[8] memory right =
            _chainingValue(_output(input, offset + leftLength, length - leftLength, chunk + uint64(leftChunks)));
        output.cv = _iv();
        for (uint256 i; i < 8; ++i) {
            output.words[i] = left[i];
            output.words[i + 8] = right[i];
        }
        output.length = 64;
        output.flags = PARENT;
    }

    function _chainingValue(Output memory output) private pure returns (uint32[8] memory cv) {
        uint32[16] memory compressed =
            _compress(output.cv, output.words, output.counter, output.length, output.flags);
        for (uint256 i; i < 8; ++i) cv[i] = compressed[i];
    }

    function _block(bytes calldata input, uint256 offset, uint256 length)
        private
        pure
        returns (uint32[16] memory words)
    {
        for (uint256 i; i < length; ++i) {
            words[i >> 2] |= uint32(uint256(uint8(input[offset + i])) << (8 * (i & 3)));
        }
    }

    function _iv() private pure returns (uint32[8] memory iv) {
        iv = [
            uint32(0x6a09e667), 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
        ];
    }

    function _compress(uint32[8] memory cv, uint32[16] memory blockWords, uint64 counter, uint32 length, uint32 flags)
        private
        pure
        returns (uint32[16] memory state)
    {
        uint32[8] memory iv = _iv();
        for (uint256 i; i < 8; ++i) state[i] = cv[i];
        for (uint256 i; i < 4; ++i) state[i + 8] = iv[i];
        state[12] = uint32(counter);
        state[13] = uint32(counter >> 32);
        state[14] = length;
        state[15] = flags;
        uint8[16] memory permutation = [
            uint8(2), 6, 3, 10, 7, 0, 4, 13,
            1, 11, 12, 5, 9, 14, 15, 8
        ];
        for (uint256 round; round < 7; ++round) {
            _g(state, 0, 4, 8, 12, blockWords[0], blockWords[1]);
            _g(state, 1, 5, 9, 13, blockWords[2], blockWords[3]);
            _g(state, 2, 6, 10, 14, blockWords[4], blockWords[5]);
            _g(state, 3, 7, 11, 15, blockWords[6], blockWords[7]);
            _g(state, 0, 5, 10, 15, blockWords[8], blockWords[9]);
            _g(state, 1, 6, 11, 12, blockWords[10], blockWords[11]);
            _g(state, 2, 7, 8, 13, blockWords[12], blockWords[13]);
            _g(state, 3, 4, 9, 14, blockWords[14], blockWords[15]);
            if (round < 6) {
                uint32[16] memory next;
                for (uint256 i; i < 16; ++i) next[i] = blockWords[permutation[i]];
                blockWords = next;
            }
        }
        for (uint256 i; i < 8; ++i) {
            state[i] ^= state[i + 8];
            state[i + 8] ^= cv[i];
        }
    }

    function _g(uint32[16] memory v, uint256 a, uint256 b, uint256 c, uint256 d, uint32 x, uint32 y)
        private
        pure
    {
        unchecked {
            v[a] = v[a] + v[b] + x;
            v[d] = _rotate(v[d] ^ v[a], 16);
            v[c] += v[d];
            v[b] = _rotate(v[b] ^ v[c], 12);
            v[a] = v[a] + v[b] + y;
            v[d] = _rotate(v[d] ^ v[a], 8);
            v[c] += v[d];
            v[b] = _rotate(v[b] ^ v[c], 7);
        }
    }

    function _rotate(uint32 value, uint256 bits) private pure returns (uint32) {
        return uint32((uint256(value) >> bits) | (uint256(value) << (32 - bits)));
    }
}
