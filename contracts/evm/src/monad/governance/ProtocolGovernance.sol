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
    error CallFailed();

    event CoreAdded(address indexed core);
    event CoreRemoved(address indexed core);
    event ActionQueued(bytes32 indexed actionId, address indexed target, uint256 value, uint256 eta);
    event ActionCancelled(bytes32 indexed actionId);
    event ActionExecuted(bytes32 indexed actionId, address indexed target, uint256 value);

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
        timelock = 2 days;
    }

    receive() external payable {}

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

    function actionId(address target, uint256 value, bytes calldata data, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data, salt));
    }

    function queue(address target, uint256 value, bytes calldata data, bytes32 salt) external returns (bytes32 id) {
        if (msg.sender != governance || target == address(0) || target.code.length == 0) revert Invalid();
        id = actionId(target, value, data, salt);
        if (id == bytes32(0) || queuedAt[id] != 0 || executed[id]) revert Invalid();
        uint256 eta = block.timestamp + timelock;
        queuedAt[id] = eta;
        emit ActionQueued(id, target, value, eta);
    }

    function cancel(address target, uint256 value, bytes calldata data, bytes32 salt) external {
        if (msg.sender != governance) revert Unauthorized();
        bytes32 id = actionId(target, value, data, salt);
        if (queuedAt[id] == 0 || executed[id]) revert Invalid();
        delete queuedAt[id];
        emit ActionCancelled(id);
    }

    function execute(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        payable
        returns (bytes memory result)
    {
        bytes32 id = actionId(target, value, data, salt);
        uint256 eta = queuedAt[id];
        if (eta == 0 || block.timestamp < eta) revert NotReady();
        if (executed[id]) revert Executed();
        if (msg.value != value) revert Invalid();
        executed[id] = true;
        delete queuedAt[id];
        (bool ok, bytes memory data_) = target.call{value: value}(data);
        if (!ok) {
            if (data_.length > 0) assembly { revert(add(data_, 32), mload(data_)) }
            revert CallFailed();
        }
        emit ActionExecuted(id, target, value);
        return data_;
    }
}
