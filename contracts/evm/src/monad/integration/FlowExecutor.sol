// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ExecutionManager} from "./ExecutionManager.sol";

contract FlowExecutor is ExecutionManager {
    constructor(address core_) ExecutionManager(core_) {}
}
