// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FlowExecutor {
    struct Flow {
        address target;
        bytes32 capability;
        bool active;
    }

    address public immutable core;
    mapping(bytes32 => Flow) public flows;
    error Unauthorized();
    error Unknown();
    error Failed();

    constructor(address core_) {
        core = core_;
    }

    function setFlow(bytes32 flowId, bytes32 capability, address target) external {
        if (msg.sender != core || target == address(0) || target.code.length == 0) revert Unauthorized();
        flows[flowId] = Flow(target, capability, true);
    }

    function disable(bytes32 flowId) external {
        if (msg.sender != core) revert Unauthorized();
        flows[flowId].active = false;
    }

    function runFlow(bytes32 creditId, bytes32 flowId, bytes calldata data) external {
        if (msg.sender != core) revert Unauthorized();
        Flow memory flow = flows[flowId];
        if (!flow.active || creditId == bytes32(0)) revert Unknown();
        (bool ok,) = flow.target.call(data);
        if (!ok) revert Failed();
    }
}
