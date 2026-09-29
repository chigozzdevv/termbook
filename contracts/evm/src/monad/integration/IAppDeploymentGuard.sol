// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppDeploymentGuard {
    function valid(address dependency) external view returns (bool);
}
