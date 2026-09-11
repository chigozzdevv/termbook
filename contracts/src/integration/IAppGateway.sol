// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppGateway {
    function buildCall(bytes32 capability, bytes calldata params) external view returns (address target, bytes memory data);
}
