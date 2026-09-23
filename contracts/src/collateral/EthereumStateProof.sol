// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library EthereumStateProof {
    uint256 internal constant MAX_NODES = 64;
    uint256 internal constant MAX_NODE_BYTES = 2048;

    struct Item {
        uint256 start;
        uint256 payload;
        uint256 length;
        uint256 end;
        bool list;
    }

    error InvalidProof();

    function verifyCommitment(
        bytes32 stateRoot,
        address vault,
        bytes32 expectedCodeHash,
        bytes32 slot,
        bytes32 commitment,
        bytes[] memory accountNodes,
        bytes[] memory storageNodes
    ) internal pure returns (bool) {
        if (
            stateRoot == bytes32(0) || vault == address(0) || expectedCodeHash == bytes32(0) || commitment == bytes32(0)
        ) {
            return false;
        }
        (bool accountFound, bytes memory account) = _value(stateRoot, keccak256(abi.encodePacked(vault)), accountNodes);
        if (!accountFound) return false;
        (bytes32 storageRoot, bytes32 codeHash) = _accountRoots(account);
        if (codeHash != expectedCodeHash) return false;
        (bool storageFound, bytes memory value) = _value(storageRoot, keccak256(abi.encodePacked(slot)), storageNodes);
        return storageFound && _storageWord(value) == commitment;
    }

    function _value(bytes32 root, bytes32 key, bytes[] memory nodes)
        private
        pure
        returns (bool found, bytes memory value)
    {
        if (root == bytes32(0) || nodes.length == 0 || nodes.length > MAX_NODES) revert InvalidProof();
        bytes32 nextHash = root;
        bytes memory inlineNode;
        bool embedded;
        uint256 nodeIndex;
        uint256 pathIndex;
        for (uint256 steps; steps < MAX_NODES + 64; ++steps) {
            bytes memory node;
            if (embedded) {
                node = inlineNode;
                embedded = false;
            } else {
                if (nodeIndex == nodes.length) return (false, value);
                node = nodes[nodeIndex++];
                if (node.length == 0 || node.length > MAX_NODE_BYTES) revert InvalidProof();
                if (keccak256(node) != nextHash) return (false, value);
            }
            Item memory top = _item(node, 0, node.length);
            if (!top.list || top.end != node.length) revert InvalidProof();
            Item[] memory children = _children(node, top);
            if (children.length == 17) {
                if (pathIndex == 64) {
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
                bytes memory compact = _payload(node, children[0]);
                (bool matches, bool leaf, uint256 consumed) = _matchPath(compact, key, pathIndex);
                if (!matches) return (false, value);
                pathIndex += consumed;
                if (leaf) {
                    if (pathIndex != 64 || children[1].list || nodeIndex != nodes.length) return (false, value);
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

    function _matchPath(bytes memory compact, bytes32 key, uint256 offset)
        private
        pure
        returns (bool matches, bool leaf, uint256 consumed)
    {
        if (compact.length == 0 || offset > 64) revert InvalidProof();
        uint8 flag = uint8(compact[0]) >> 4;
        if (flag > 3 || ((flag & 1) == 0 && (uint8(compact[0]) & 15) != 0)) revert InvalidProof();
        leaf = (flag & 2) != 0;
        uint256 start = (flag & 1) == 0 ? 2 : 1;
        consumed = compact.length * 2 - start;
        if (offset + consumed > 64) return (false, leaf, consumed);
        for (uint256 i; i < consumed; ++i) {
            uint8 actual =
                (i + start) % 2 == 0 ? uint8(compact[(i + start) / 2]) >> 4 : uint8(compact[(i + start) / 2]) & 15;
            if (actual != _nibble(key, offset + i)) return (false, leaf, consumed);
        }
        return (true, leaf, consumed);
    }

    function _nibble(bytes32 key, uint256 index) private pure returns (uint8) {
        return uint8(uint256(key >> (4 * (63 - index))) & 15);
    }

    function _accountRoots(bytes memory account) private pure returns (bytes32 storageRoot, bytes32 codeHash) {
        Item memory top = _item(account, 0, account.length);
        if (!top.list || top.end != account.length) revert InvalidProof();
        Item[] memory fields = _children(account, top);
        if (fields.length != 4 || fields[2].list || fields[2].length != 32 || fields[3].list || fields[3].length != 32)
        {
            revert InvalidProof();
        }
        return (_word(account, fields[2].payload), _word(account, fields[3].payload));
    }

    function _storageWord(bytes memory encoded) private pure returns (bytes32 result) {
        Item memory item = _item(encoded, 0, encoded.length);
        if (item.list || item.end != encoded.length || item.length == 0 || item.length > 32) revert InvalidProof();
        if (encoded[item.payload] == bytes1(0)) revert InvalidProof();
        for (uint256 i; i < item.length; ++i) {
            result = bytes32((uint256(result) << 8) | uint8(encoded[item.payload + i]));
        }
    }

    function _children(bytes memory data, Item memory parent) private pure returns (Item[] memory result) {
        uint256 cursor = parent.payload;
        uint256 count;
        while (cursor < parent.end) {
            cursor = _item(data, cursor, parent.end).end;
            ++count;
            if (count > 17) revert InvalidProof();
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
        if (result.length > limit - result.payload) revert InvalidProof();
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
