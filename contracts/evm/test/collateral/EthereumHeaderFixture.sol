// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthereumExecutionHeaderProof} from "../../src/monad/collateral/EthereumExecutionHeaderProof.sol";

library EthereumHeaderFixture {
    function header(uint256 timestamp, bytes32 stateRoot, bytes32 receiptsRoot)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory first = bytes.concat(
            _rlpBytes(abi.encodePacked(bytes32(uint256(1)))),
            _rlpBytes(abi.encodePacked(keccak256(hex"c0"))),
            _rlpBytes(abi.encodePacked(address(0xBEEF))),
            _rlpBytes(abi.encodePacked(stateRoot)),
            _rlpBytes(abi.encodePacked(bytes32(uint256(2))))
        );
        bytes memory second = bytes.concat(
            _rlpBytes(abi.encodePacked(receiptsRoot)),
            _rlpBytes(new bytes(256)),
            _rlpBytes(hex""),
            _rlpBytes(hex"01"),
            _rlpBytes(hex"01")
        );
        bytes memory third = bytes.concat(
            _rlpBytes(hex""),
            _rlpBytes(_number(timestamp)),
            _rlpBytes(hex""),
            _rlpBytes(abi.encodePacked(bytes32(uint256(3)))),
            _rlpBytes(new bytes(8))
        );
        bytes memory fourth = bytes.concat(
            _rlpBytes(hex"01"),
            _rlpBytes(abi.encodePacked(bytes32(uint256(4)))),
            _rlpBytes(hex""),
            _rlpBytes(hex""),
            _rlpBytes(abi.encodePacked(bytes32(uint256(5))))
        );
        bytes memory fields = bytes.concat(first, second, third, fourth, _rlpBytes(abi.encodePacked(bytes32(uint256(6)))));
        bytes memory rawHeader = bytes.concat(hex"f9", bytes2(uint16(fields.length)), fields);
        return abi.encode(rawHeader, hex"01");
    }

    function roots(bytes memory wrapped) internal pure returns (bytes32 stateRoot, bytes32 receiptsRoot, uint256 timestamp) {
        (bytes memory rawHeader,) = abi.decode(wrapped, (bytes, bytes));
        return EthereumExecutionHeaderProof.roots(rawHeader, keccak256(rawHeader));
    }

    function raw(bytes memory wrapped) internal pure returns (bytes memory rawHeader) {
        (rawHeader,) = abi.decode(wrapped, (bytes, bytes));
    }

    function _number(uint256 value) private pure returns (bytes memory result) {
        if (value == 0) return hex"";
        uint256 size;
        uint256 remaining = value;
        while (remaining != 0) {
            ++size;
            remaining >>= 8;
        }
        result = new bytes(size);
        for (uint256 i; i < size; ++i) {
            result[size - i - 1] = bytes1(uint8(value >> (i * 8)));
        }
    }

    function _rlpBytes(bytes memory value) private pure returns (bytes memory) {
        if (value.length == 1 && uint8(value[0]) < 128) return value;
        if (value.length <= 55) return bytes.concat(bytes1(uint8(0x80 + value.length)), value);
        if (value.length <= 255) return bytes.concat(hex"b8", bytes1(uint8(value.length)), value);
        return bytes.concat(hex"b9", bytes2(uint16(value.length)), value);
    }
}
