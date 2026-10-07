// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestnetProxy} from "../monad/governance/TestnetProxy.sol";
import {UpgradeController} from "../monad/governance/UpgradeController.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

library CodeInspection {
    function registeredTestnetProxy(address target) internal view returns (bool) {
        if (block.chainid != 10143 && block.chainid != 11155111) return false;
        try TestnetProxy(payable(target)).proxyAdmin() returns (address admin) {
            try ProxyAdmin(admin).owner() returns (address controller) {
                try UpgradeController(controller).contractIds(target) returns (bytes32 id) { return id != bytes32(0); }
                catch { return false; }
            } catch { return false; }
        } catch { return false; }
    }

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
