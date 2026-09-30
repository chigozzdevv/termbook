// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ExecutionTypes} from "./IExecutionPolicy.sol";

interface IAppGateway {
    function buildCall(bytes32 creditId, address account, bytes32 capability, bytes calldata params)
        external view returns (ExecutionTypes.Call memory);
}
