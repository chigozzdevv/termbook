// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppDeploymentGuard} from "./IAppDeploymentGuard.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";

contract ImplementationGuard is IAppDeploymentGuard {
    address public immutable proxy;
    address public immutable implementation;
    bytes4 public immutable getter;
    bytes32 public immutable proxyCodeHash;
    bytes32 public immutable implementationCodeHash;

    error Invalid();

    constructor(address proxy_, address implementation_, bytes4 getter_) {
        if (proxy_.code.length == 0 || implementation_.code.length == 0 || getter_ == bytes4(0)
            || CodeInspection.delegates(implementation_)) revert Invalid();
        proxy = proxy_;
        implementation = implementation_;
        getter = getter_;
        proxyCodeHash = proxy_.codehash;
        implementationCodeHash = implementation_.codehash;
        if (!valid(proxy_)) revert Invalid();
    }

    function valid(address dependency) public view returns (bool) {
        if (dependency != proxy || proxy.codehash != proxyCodeHash
            || implementation.codehash != implementationCodeHash) return false;
        (bool ok, bytes memory value) = proxy.staticcall(abi.encodeWithSelector(getter));
        return ok && value.length == 32 && keccak256(value) == keccak256(abi.encode(implementation));
    }
}
