// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library EvmReceiptProof {
    uint256 internal constant MAX_NODES = 64;
    uint256 internal constant MAX_NODE_BYTES = 96_000;
    uint256 internal constant MAX_RECEIPT_BYTES = 64_000;
    uint256 internal constant MAX_LOGS = 512;
    bytes32 internal constant AUTHORIZED_TOPIC = keccak256("RemoteActionAuthorized(bytes32,bytes32,uint8)");
    bytes32 internal constant APPLIED_TOPIC = keccak256("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)");
    bytes32 internal constant RECOVERY_OPERATION_TOPIC =
        keccak256("RecoveryOperationCreated(bytes32,bytes32,address)");

    struct Item {
        uint256 start;
        uint256 payload;
        uint256 length;
        uint256 end;
        bool list;
    }

    error InvalidProof();

    function verify(
        bytes32 receiptsRoot,
        bytes calldata proof,
        address emitter,
        bytes32 eventDigest,
        bool authorization
    ) internal pure returns (bool) {
        return _verify(receiptsRoot, proof, emitter, eventDigest, authorization ? 0 : 1);
    }

    function verifyRecoveryOperation(bytes32 receiptsRoot, bytes calldata proof, address emitter, bytes32 eventDigest)
        internal
        pure
        returns (bool)
    {
        return _verify(receiptsRoot, proof, emitter, eventDigest, 2);
    }

    function _verify(
        bytes32 receiptsRoot,
        bytes calldata proof,
        address emitter,
        bytes32 eventDigest,
        uint8 kind
    ) private pure returns (bool) {
        if (receiptsRoot == bytes32(0) || emitter == address(0) || eventDigest == bytes32(0)) {
            return false;
        }
        (uint256 txIndex, uint256 logIndex, bytes[] memory nodes) = abi.decode(proof, (uint256, uint256, bytes[]));
        if (txIndex > type(uint64).max || logIndex >= MAX_LOGS) return false;
        (bool found, bytes memory receipt) = _value(receiptsRoot, _receiptKey(txIndex), nodes);
        return found && _event(receipt, logIndex, emitter, eventDigest, kind);
    }

    function _value(bytes32 root, bytes memory key, bytes[] memory nodes)
        private
        pure
        returns (bool found, bytes memory value)
    {
        if (nodes.length == 0 || nodes.length > MAX_NODES) revert InvalidProof();
        bytes32 nextHash = root;
        bytes memory inlineNode;
        bool embedded;
        uint256 nodeIndex;
        uint256 pathIndex;
        uint256 pathLength = key.length * 2;
        for (uint256 steps; steps < MAX_NODES + 32; ++steps) {
            bytes memory node;
            if (embedded) {
                node = inlineNode;
                embedded = false;
            } else {
                if (nodeIndex == nodes.length) return (false, value);
                node = nodes[nodeIndex++];
                if (node.length == 0 || node.length > MAX_NODE_BYTES || keccak256(node) != nextHash) {
                    return (false, value);
                }
            }
            Item memory top = _item(node, 0, node.length);
            if (!top.list || top.end != node.length) revert InvalidProof();
            Item[] memory children = _children(node, top, 17);
            if (children.length == 17) {
                if (pathIndex == pathLength) {
                    if (children[16].list || children[16].length == 0 || nodeIndex != nodes.length) {
                        return (false, value);
                    }
                    return (true, _payload(node, children[16]));
                }
                Item memory child = children[_nibble(key, pathIndex++)];
                if (child.length == 0 && !child.list) return (false, value);
                (nextHash, inlineNode, embedded) = _reference(node, child);
            } else if (children.length == 2) {
                if (children[0].list) revert InvalidProof();
                (bool matches, bool leaf, uint256 consumed) = _matchPath(_payload(node, children[0]), key, pathIndex);
                if (!matches) return (false, value);
                pathIndex += consumed;
                if (leaf) {
                    if (pathIndex != pathLength || children[1].list || nodeIndex != nodes.length) {
                        return (false, value);
                    }
                    return (true, _payload(node, children[1]));
                }
                if (consumed == 0) revert InvalidProof();
                (nextHash, inlineNode, embedded) = _reference(node, children[1]);
            } else {
                revert InvalidProof();
            }
        }
        revert InvalidProof();
    }

    function _event(bytes memory receipt, uint256 logIndex, address emitter, bytes32 digest, uint8 kind)
        private
        pure
        returns (bool)
    {
        if (receipt.length == 0 || receipt.length > MAX_RECEIPT_BYTES) return false;
        uint256 offset;
        if (uint8(receipt[0]) < 0x80) {
            uint8 receiptType = uint8(receipt[0]);
            if (receiptType == 0 || receiptType > 4) return false;
            offset = 1;
        }
        Item memory top = _item(receipt, offset, receipt.length);
        if (!top.list || top.end != receipt.length) revert InvalidProof();
        Item[] memory fields = _children(receipt, top, 4);
        if (
            fields.length != 4 || fields[0].list || fields[0].length != 1 || receipt[fields[0].payload] != bytes1(0x01)
                || fields[1].list || fields[1].length == 0 || fields[1].length > 32
                || receipt[fields[1].payload] == bytes1(0) || fields[2].list || fields[2].length != 256
                || !fields[3].list
        ) return false;
        uint256 cursor = fields[3].payload;
        for (uint256 i; cursor < fields[3].end && i < MAX_LOGS; ++i) {
            Item memory log = _item(receipt, cursor, fields[3].end);
            cursor = log.end;
            if (i == logIndex) return _exactLog(receipt, log, emitter, digest, kind);
        }
        return false;
    }

    function _exactLog(bytes memory receipt, Item memory log, address emitter, bytes32 digest, uint8 kind)
        private
        pure
        returns (bool)
    {
        if (!log.list) return false;
        Item[] memory fields = _children(receipt, log, 3);
        if (fields.length != 3 || fields[0].list || fields[0].length != 20 || !fields[1].list || fields[2].list) {
            return false;
        }
        if (address(uint160(uint256(_word(receipt, fields[0].payload)) >> 96)) != emitter) return false;
        uint256 topicCount = kind == 0 ? 3 : 4;
        Item[] memory topics = _children(receipt, fields[1], topicCount);
        if (topics.length != topicCount) return false;
        for (uint256 i; i < topics.length; ++i) {
            if (topics[i].list || topics[i].length != 32) return false;
        }
        bytes32 topic0 = _word(receipt, topics[0].payload);
        bytes32 topic1 = _word(receipt, topics[1].payload);
        bytes32 topic2 = _word(receipt, topics[2].payload);
        if (topic1 == bytes32(0) || topic2 == bytes32(0)) return false;
        if (kind == 2) {
            if (topic0 != RECOVERY_OPERATION_TOPIC || fields[2].length != 0) return false;
            bytes32 inboxTopic = _word(receipt, topics[3].payload);
            if (uint256(inboxTopic) >> 160 != 0 || uint256(inboxTopic) == 0) return false;
            return keccak256(abi.encode(topic1, topic2, address(uint160(uint256(inboxTopic))))) == digest;
        }
        if (kind == 0) {
            if (topic0 != AUTHORIZED_TOPIC || fields[2].length != 32) return false;
            uint256 authorizedKind = uint256(_word(receipt, fields[2].payload));
            return authorizedKind <= 1 && keccak256(abi.encode(topic1, topic2, uint8(authorizedKind))) == digest;
        }
        if (topic0 != APPLIED_TOPIC || fields[2].length != 64) return false;
        bytes32 recipientTopic = _word(receipt, topics[3].payload);
        if (uint256(recipientTopic) >> 160 != 0) return false;
        address recipient = address(uint160(uint256(recipientTopic)));
        uint256 amount = uint256(_word(receipt, fields[2].payload));
        uint256 actionKind = uint256(_word(receipt, fields[2].payload + 32));
        return recipient != address(0) && amount != 0 && actionKind <= 1
            && keccak256(abi.encode(topic1, topic2, recipient, amount, uint8(actionKind))) == digest;
    }

    function _receiptKey(uint256 index) private pure returns (bytes memory key) {
        if (index == 0) return hex"80";
        if (index < 128) return abi.encodePacked(bytes1(uint8(index)));
        uint256 size;
        uint256 value = index;
        while (value != 0) {
            ++size;
            value >>= 8;
        }
        key = new bytes(size + 1);
        key[0] = bytes1(uint8(0x80 + size));
        for (uint256 i; i < size; ++i) {
            key[size - i] = bytes1(uint8(index >> (i * 8)));
        }
    }

    function _reference(bytes memory node, Item memory child)
        private
        pure
        returns (bytes32 hash, bytes memory encoded, bool embedded)
    {
        if (child.list) {
            encoded = _slice(node, child.start, child.end - child.start);
            if (encoded.length >= 32) revert InvalidProof();
            return (bytes32(0), encoded, true);
        }
        if (child.length != 32) revert InvalidProof();
        return (_word(node, child.payload), encoded, false);
    }

    function _matchPath(bytes memory compact, bytes memory key, uint256 offset)
        private
        pure
        returns (bool matches, bool leaf, uint256 consumed)
    {
        uint256 pathLength = key.length * 2;
        if (compact.length == 0 || offset > pathLength) revert InvalidProof();
        uint8 flag = uint8(compact[0]) >> 4;
        if (flag > 3 || ((flag & 1) == 0 && (uint8(compact[0]) & 15) != 0)) revert InvalidProof();
        leaf = (flag & 2) != 0;
        uint256 start = (flag & 1) == 0 ? 2 : 1;
        consumed = compact.length * 2 - start;
        if (offset + consumed > pathLength) return (false, leaf, consumed);
        for (uint256 i; i < consumed; ++i) {
            uint256 nibbleIndex = i + start;
            uint8 actual =
                nibbleIndex % 2 == 0 ? uint8(compact[nibbleIndex / 2]) >> 4 : uint8(compact[nibbleIndex / 2]) & 15;
            if (actual != _nibble(key, offset + i)) return (false, leaf, consumed);
        }
        return (true, leaf, consumed);
    }

    function _nibble(bytes memory value, uint256 index) private pure returns (uint8) {
        uint8 octet = uint8(value[index / 2]);
        return index % 2 == 0 ? octet >> 4 : octet & 15;
    }

    function _children(bytes memory data, Item memory parent, uint256 maximum)
        private
        pure
        returns (Item[] memory result)
    {
        uint256 cursor = parent.payload;
        uint256 count;
        while (cursor < parent.end) {
            cursor = _item(data, cursor, parent.end).end;
            if (++count > maximum) revert InvalidProof();
        }
        if (cursor != parent.end) revert InvalidProof();
        result = new Item[](count);
        cursor = parent.payload;
        for (uint256 i; i < count; ++i) {
            result[i] = _item(data, cursor, parent.end);
            cursor = result[i].end;
        }
    }

    function _item(bytes memory data, uint256 offset, uint256 limit) private pure returns (Item memory result) {
        if (offset >= limit || limit > data.length) revert InvalidProof();
        uint8 prefix = uint8(data[offset]);
        result.start = offset;
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
            (result.payload, result.length) = _longLength(data, offset, limit, prefix - 0xb7);
            if (result.length <= 55) revert InvalidProof();
        } else if (prefix <= 0xf7) {
            result.list = true;
            result.payload = offset + 1;
            result.length = prefix - 0xc0;
        } else {
            result.list = true;
            (result.payload, result.length) = _longLength(data, offset, limit, prefix - 0xf7);
            if (result.length <= 55) revert InvalidProof();
        }
        if (result.payload > limit || result.length > limit - result.payload) revert InvalidProof();
        result.end = result.payload + result.length;
        if (!result.list && result.length == 1 && uint8(data[result.payload]) < 0x80 && prefix == 0x81) {
            revert InvalidProof();
        }
    }

    function _longLength(bytes memory data, uint256 offset, uint256 limit, uint256 size)
        private
        pure
        returns (uint256 payload, uint256 length)
    {
        if (size == 0 || size > 8 || size >= limit - offset || data[offset + 1] == bytes1(0)) {
            revert InvalidProof();
        }
        for (uint256 i; i < size; ++i) {
            length = (length << 8) | uint8(data[offset + 1 + i]);
        }
        payload = offset + 1 + size;
    }

    function _payload(bytes memory data, Item memory item) private pure returns (bytes memory) {
        return _slice(data, item.payload, item.length);
    }

    function _slice(bytes memory data, uint256 offset, uint256 length) private pure returns (bytes memory result) {
        result = new bytes(length);
        for (uint256 i; i < length; ++i) {
            result[i] = data[offset + i];
        }
    }

    function _word(bytes memory data, uint256 offset) private pure returns (bytes32 result) {
        assembly {
            result := mload(add(add(data, 0x20), offset))
        }
    }
}
