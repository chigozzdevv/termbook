// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library CodeInspection {
    function delegates(address target) internal view returns (bool) {
        bytes memory code = target.code;
        uint256 length = code.length;
        if (length >= 2) {
            uint256 metadata = (uint256(uint8(code[length - 2])) << 8) | uint8(code[length - 1]);
            if (metadata + 2 < length && uint8(code[length - metadata - 2]) >> 5 == 5) length -= metadata + 2;
        }
        for (uint256 i; i < length; ++i) {
            uint8 opcode = uint8(code[i]);
            if (opcode == 0xf4 || opcode == 0xf2) return true;
            if (opcode >= 0x60 && opcode <= 0x7f) i += opcode - 0x5f;
        }
        return false;
    }
}
