// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ProtocolGovernance {
    address public immutable governance;
    uint256 public immutable timelock;
    mapping(address => bool) public cores;
    mapping(bytes32 => uint256) public queuedAt;
    mapping(bytes32 => bool) public executed;
    error Unauthorized();
    error Invalid();
    error NotReady();
    error Executed();
    event CoreAdded(address indexed core);
    event CoreRemoved(address indexed core);
    event ActionQueued(bytes32 indexed actionId, uint256 eta);
    event ActionExecuted(bytes32 indexed actionId);

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
        timelock = 2 days;
    }

    function addCore(address core) external {
        if (msg.sender != governance || core == address(0) || core.code.length == 0) revert Invalid();
        cores[core] = true;
        emit CoreAdded(core);
    }

    function removeCore(address core) external {
        if (msg.sender != governance) revert Unauthorized();
        cores[core] = false;
        emit CoreRemoved(core);
    }

    function queue(bytes32 actionId) external {
        if (msg.sender != governance || actionId == bytes32(0) || queuedAt[actionId] != 0) revert Invalid();
        queuedAt[actionId] = block.timestamp + timelock;
        emit ActionQueued(actionId, queuedAt[actionId]);
    }

    function markExecuted(bytes32 actionId) external {
        if (msg.sender != governance || queuedAt[actionId] == 0 || block.timestamp < queuedAt[actionId]) revert NotReady();
        if (executed[actionId]) revert Executed();
        executed[actionId] = true;
        emit ActionExecuted(actionId);
    }
}
