// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library EthereumExecutionHeaderProof {
    uint256 internal constant MAX_HEADER_BYTES = 4096;

    struct Item {
        uint256 payload;
        uint256 length;
        uint256 end;
        bool list;
    }

    error InvalidHeader();

    function roots(bytes memory encoded, bytes32 finalizedBlockHash)
        internal
        pure
        returns (bytes32 stateRoot, bytes32 receiptsRoot, uint256 timestamp)
    {
        if (
            finalizedBlockHash == bytes32(0) || encoded.length == 0 || encoded.length > MAX_HEADER_BYTES
                || keccak256(encoded) != finalizedBlockHash
        ) revert InvalidHeader();
        Item memory header = _item(encoded, 0, encoded.length);
        if (!header.list || header.end != encoded.length) revert InvalidHeader();

        uint256 cursor = header.payload;
        uint256 field;
        while (cursor < header.end) {
            if (field >= 21) revert InvalidHeader();
            Item memory value = _item(encoded, cursor, header.end);
            if (value.list) revert InvalidHeader();
            if (field == 3) stateRoot = _word(encoded, value);
            if (field == 5) receiptsRoot = _word(encoded, value);
            if (field == 11) timestamp = _number(encoded, value);
            cursor = value.end;
            ++field;
        }
        if ((field != 20 && field != 21) || stateRoot == bytes32(0) || receiptsRoot == bytes32(0)
            || timestamp == 0) revert InvalidHeader();
    }

    function _word(bytes memory encoded, Item memory value) private pure returns (bytes32 result) {
        if (value.length != 32) revert InvalidHeader();
        assembly ("memory-safe") {
            result := mload(add(add(encoded, 0x20), mload(value)))
        }
    }

    function _number(bytes memory encoded, Item memory value) private pure returns (uint256 result) {
        if (value.length == 0 || value.length > 8 || encoded[value.payload] == bytes1(0)) revert InvalidHeader();
        for (uint256 i; i < value.length; ++i) {
            result = (result << 8) | uint8(encoded[value.payload + i]);
        }
    }

    function _item(bytes memory encoded, uint256 offset, uint256 limit) private pure returns (Item memory result) {
        if (offset >= limit || limit > encoded.length) revert InvalidHeader();
        uint8 prefix = uint8(encoded[offset]);
        if (prefix < 0x80) {
            result.payload = offset;
            result.length = 1;
            result.end = offset + 1;
            return result;
        }
        if (prefix <= 0xb7) {
            result.payload = offset + 1;
            result.length = prefix - 0x80;
        } else if (prefix <= 0xbf) {
            (result.payload, result.length) = _longLength(encoded, offset, limit, prefix - 0xb7);
            if (result.length <= 55) revert InvalidHeader();
        } else if (prefix <= 0xf7) {
            result.list = true;
            result.payload = offset + 1;
            result.length = prefix - 0xc0;
        } else {
            result.list = true;
            (result.payload, result.length) = _longLength(encoded, offset, limit, prefix - 0xf7);
            if (result.length <= 55) revert InvalidHeader();
        }
        if (result.payload > limit || result.length > limit - result.payload) revert InvalidHeader();
        result.end = result.payload + result.length;
        if (!result.list && result.length == 1 && uint8(encoded[result.payload]) < 0x80 && prefix == 0x81) {
            revert InvalidHeader();
        }
    }

    function _longLength(bytes memory encoded, uint256 offset, uint256 limit, uint256 size)
        private
        pure
        returns (uint256 payload, uint256 length)
    {
        if (size == 0 || size > 8 || size >= limit - offset || encoded[offset + 1] == bytes1(0)) {
            revert InvalidHeader();
        }
        for (uint256 i; i < size; ++i) {
            length = (length << 8) | uint8(encoded[offset + 1 + i]);
        }
        payload = offset + 1 + size;
    }
}
