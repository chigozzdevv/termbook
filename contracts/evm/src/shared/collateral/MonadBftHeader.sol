// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Blake3} from "./Blake3.sol";

library MonadBftHeader {
    struct Item {
        uint256 start;
        uint256 payload;
        uint256 length;
        uint256 end;
        bool list;
    }

    struct Header {
        bytes32 id;
        bytes32 qcId;
        uint64 round;
        uint64 epoch;
        uint64 qcRound;
        uint64 qcEpoch;
        uint64 sequence;
        uint128 timestampNs;
    }

    struct Execution {
        bytes32 id;
        bytes32 receiptsRoot;
        uint64 number;
        uint64 timestamp;
    }

    error InvalidHeader();

    function read(bytes calldata encoded) internal pure returns (Header memory header) {
        if (encoded.length == 0 || encoded.length > Blake3.MAX_INPUT) revert InvalidHeader();
        Item[] memory fields = _fields(encoded, _top(encoded), 13);
        header.id = Blake3.hash(encoded);
        header.round = _u64(encoded, fields[0]);
        header.epoch = _u64(encoded, fields[1]);
        header.sequence = _u64(encoded, fields[4]);
        header.timestampNs = _u128(encoded, fields[5]);
        if (header.round == 0 || header.epoch == 0 || header.sequence == 0 || header.timestampNs == 0) {
            revert InvalidHeader();
        }
        Item[] memory qc = _fields(encoded, fields[2], 2);
        Item[] memory vote = _fields(encoded, qc[0], 3);
        header.qcId = _word(encoded, vote[0]);
        header.qcRound = _u64(encoded, vote[1]);
        header.qcEpoch = _u64(encoded, vote[2]);
        if (header.qcId == bytes32(0) || header.qcEpoch == 0 || !fields[7].list) revert InvalidHeader();
    }

    function execution(bytes calldata encoded, uint256 index) internal pure returns (Execution memory result) {
        Item[] memory consensusFields = _fields(encoded, _top(encoded), 13);
        Item memory list = consensusFields[7];
        if (!list.list || index > 3) revert InvalidHeader();
        uint256 cursor = list.payload;
        Item memory selected;
        for (uint256 i; cursor < list.end; ++i) {
            if (i >= 4) revert InvalidHeader();
            Item memory item = _item(encoded, cursor, list.end);
            if (i == index) selected = item;
            cursor = item.end;
        }
        if (selected.end == 0 || !selected.list) revert InvalidHeader();
        Item[] memory fields = _variableFields(encoded, selected, 21);
        if (fields.length != 20 && fields.length != 21) revert InvalidHeader();
        result.receiptsRoot = _word(encoded, fields[5]);
        result.number = _u64(encoded, fields[8]);
        result.timestamp = _u64(encoded, fields[11]);
        if (result.receiptsRoot == bytes32(0) || result.number == 0 || result.timestamp == 0) {
            revert InvalidHeader();
        }
        result.id = keccak256(encoded[selected.start:selected.end]);
    }

    function executionCount(bytes calldata encoded) internal pure returns (uint256) {
        Item[] memory consensusFields = _fields(encoded, _top(encoded), 13);
        return _variableFields(encoded, consensusFields[7], 4).length;
    }

    function _top(bytes calldata encoded) private pure returns (Item memory top) {
        top = _item(encoded, 0, encoded.length);
        if (!top.list || top.end != encoded.length) revert InvalidHeader();
    }

    function _fields(bytes calldata encoded, Item memory parent, uint256 count)
        private
        pure
        returns (Item[] memory fields)
    {
        fields = _variableFields(encoded, parent, count);
        if (fields.length != count) revert InvalidHeader();
    }

    function _variableFields(bytes calldata encoded, Item memory parent, uint256 maxCount)
        private
        pure
        returns (Item[] memory fields)
    {
        if (!parent.list) revert InvalidHeader();
        uint256 cursor = parent.payload;
        uint256 count;
        while (cursor < parent.end) {
            if (++count > maxCount) revert InvalidHeader();
            cursor = _item(encoded, cursor, parent.end).end;
        }
        if (cursor != parent.end) revert InvalidHeader();
        fields = new Item[](count);
        cursor = parent.payload;
        for (uint256 i; i < count; ++i) {
            fields[i] = _item(encoded, cursor, parent.end);
            cursor = fields[i].end;
        }
    }

    function _item(bytes calldata encoded, uint256 offset, uint256 limit) private pure returns (Item memory result) {
        if (offset >= limit) revert InvalidHeader();
        uint8 prefix = uint8(encoded[offset]);
        uint256 head;
        uint256 length;
        if (prefix < 0x80) {
            result.start = offset;
            result.payload = offset;
            result.length = 1;
            result.end = offset + 1;
            return result;
        }
        if (prefix <= 0xb7) {
            head = 1;
            length = prefix - 0x80;
        } else if (prefix <= 0xbf) {
            head = prefix - 0xb7;
            length = _longLength(encoded, offset + 1, head, limit);
            ++head;
            if (length < 56) revert InvalidHeader();
        } else if (prefix <= 0xf7) {
            result.list = true;
            head = 1;
            length = prefix - 0xc0;
        } else {
            result.list = true;
            head = prefix - 0xf7;
            length = _longLength(encoded, offset + 1, head, limit);
            ++head;
            if (length < 56) revert InvalidHeader();
        }
        if (offset + head > limit || length > limit - offset - head) revert InvalidHeader();
        result.start = offset;
        result.payload = offset + head;
        result.length = length;
        result.end = result.payload + length;
        if (!result.list && length == 1 && uint8(encoded[result.payload]) < 0x80) revert InvalidHeader();
    }

    function _longLength(bytes calldata encoded, uint256 offset, uint256 bytesCount, uint256 limit)
        private
        pure
        returns (uint256 length)
    {
        if (bytesCount == 0 || bytesCount > 8 || offset + bytesCount > limit || encoded[offset] == bytes1(0)) {
            revert InvalidHeader();
        }
        for (uint256 i; i < bytesCount; ++i) length = (length << 8) | uint8(encoded[offset + i]);
    }

    function _word(bytes calldata encoded, Item memory item) private pure returns (bytes32 value) {
        if (item.list || item.length != 32) revert InvalidHeader();
        assembly ("memory-safe") {
            value := calldataload(add(encoded.offset, mload(add(item, 0x20))))
        }
    }

    function _u64(bytes calldata encoded, Item memory item) private pure returns (uint64) {
        uint128 value = _u128(encoded, item);
        if (value > type(uint64).max) revert InvalidHeader();
        return uint64(value);
    }

    function _u128(bytes calldata encoded, Item memory item) private pure returns (uint128 value) {
        if (item.list || item.length > 16 || (item.length > 0 && encoded[item.payload] == bytes1(0))) {
            revert InvalidHeader();
        }
        for (uint256 i; i < item.length; ++i) value = (value << 8) | uint8(encoded[item.payload + i]);
    }
}
