// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppDeploymentGuard} from "./IAppDeploymentGuard.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";

// Admission must verify that delegation uses only the reviewed fixed library addresses.
contract LinkedLibraryGuard is IAppDeploymentGuard {
    address public immutable proxy;
    address public immutable implementation;
    bytes4 public immutable getter;
    bytes32 public immutable proxyCodeHash;
    bytes32 public immutable implementationCodeHash;
    address[] private libraries;
    mapping(address => bytes32) public libraryCodeHash;
    error Invalid();

    constructor(address proxy_, address implementation_, bytes4 getter_, address[] memory libraries_) {
        if (proxy_.code.length == 0 || implementation_.code.length == 0 || getter_ == bytes4(0)
            || libraries_.length == 0 || libraries_.length > 16) revert Invalid();
        proxy = proxy_;
        implementation = implementation_;
        getter = getter_;
        proxyCodeHash = proxy_.codehash;
        implementationCodeHash = implementation_.codehash;
        bytes memory code = implementation_.code;
        for (uint256 i; i < libraries_.length; ++i) {
            address linked = libraries_[i];
            if (linked == proxy_ || linked == implementation_ || linked.code.length == 0
                || libraryCodeHash[linked] != bytes32(0) || CodeInspection.delegates(linked)
                || !_references(code, linked)) revert Invalid();
            libraries.push(linked);
            libraryCodeHash[linked] = linked.codehash;
        }
        if (!valid(proxy_)) revert Invalid();
    }

    function libraryCount() external view returns (uint256) { return libraries.length; }
    function libraryAt(uint256 index) external view returns (address) { return libraries[index]; }

    function valid(address dependency) public view returns (bool) {
        if (dependency != proxy || proxy.codehash != proxyCodeHash
            || implementation.codehash != implementationCodeHash) return false;
        (bool ok, bytes memory result) = proxy.staticcall(abi.encodeWithSelector(getter));
        if (!ok || result.length != 32 || keccak256(result) != keccak256(abi.encode(implementation))) return false;
        for (uint256 i; i < libraries.length; ++i) {
            if (libraries[i].codehash != libraryCodeHash[libraries[i]]) return false;
        }
        return true;
    }

    function _references(bytes memory code, address linked) private pure returns (bool) {
        for (uint256 i; i < code.length; ++i) {
            uint8 opcode = uint8(code[i]);
            if (opcode < 0x60 || opcode > 0x7f) continue;
            uint256 size = opcode - 0x5f;
            if (i + size >= code.length) return false;
            if (size == 20 || size == 32) {
                uint256 value;
                for (uint256 j = 1; j <= size; ++j) value = (value << 8) | uint8(code[i + j]);
                if (value == uint256(uint160(linked))) return true;
            }
            i += size;
        }
        return false;
    }
}
