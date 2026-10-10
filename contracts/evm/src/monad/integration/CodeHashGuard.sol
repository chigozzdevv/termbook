// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppDeploymentGuard} from "./IAppDeploymentGuard.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";

contract CodeHashGuard is IAppDeploymentGuard {
    address public immutable target;
    bytes32 public immutable codeHash;
    error Invalid();

    constructor(address target_) {
        if (target_.code.length == 0 || CodeInspection.delegates(target_)) revert Invalid();
        target = target_;
        codeHash = target_.codehash;
    }

    function valid(address dependency) external view returns (bool) {
        return dependency == target && target.code.length != 0 && target.codehash == codeHash;
    }
}
