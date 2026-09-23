// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract IntegrationRegistry {
    struct Version {
        bytes32 codeHash;
        bool active;
        bool frozen;
    }

    struct CallPolicy {
        bytes32 codeHash;
        uint256 maxDataLength;
        uint8 recipientArg;
        uint8 amountArg;
        uint256 maxAmount;
        bool active;
    }

    mapping(bytes32 => Version) public versions;
    mapping(bytes32 => uint256) public callCount;
    mapping(bytes32 => mapping(address => mapping(bytes4 => bytes32))) public callCodeHashes;
    mapping(bytes32 => mapping(address => mapping(bytes4 => CallPolicy))) public callPolicies;
    address public immutable reviewer;
    error Unauthorized();
    error Invalid();
    error Frozen();

    event VersionApproved(bytes32 indexed id, bytes32 codeHash);
    event VersionActivated(bytes32 indexed id);
    event VersionFrozen(bytes32 indexed id);
    event CallRegistered(bytes32 indexed id, address indexed target, bytes4 selector);

    constructor(address reviewer_) {
        reviewer = reviewer_;
    }

    function approve(bytes32 id, bytes32 codeHash) external {
        if (msg.sender != reviewer || id == bytes32(0) || codeHash == bytes32(0)) revert Unauthorized();
        Version storage version = versions[id];
        if (version.frozen) revert Frozen();
        if (version.codeHash != bytes32(0)) revert Invalid();
        version.codeHash = codeHash;
        emit VersionApproved(id, codeHash);
    }

    function activate(bytes32 id) external {
        if (msg.sender != reviewer) revert Unauthorized();
        Version storage version = versions[id];
        if (version.frozen) revert Frozen();
        if (version.codeHash == bytes32(0) || version.active || callCount[id] == 0) revert Invalid();
        version.active = true;
        emit VersionActivated(id);
    }

    function freeze(bytes32 id) external {
        if (msg.sender != reviewer) revert Unauthorized();
        versions[id].frozen = true;
        versions[id].active = false;
        emit VersionFrozen(id);
    }

    function registerCall(
        bytes32 id,
        address target,
        bytes4 selector,
        uint256 maxDataLength,
        uint8 recipientArg,
        uint8 amountArg,
        uint256 maxAmount
    ) external {
        if (msg.sender != reviewer || target == address(0) || target.code.length == 0 || selector == bytes4(0)) {
            revert Invalid();
        }
        Version memory version = versions[id];
        if (version.frozen) revert Frozen();
        if (version.codeHash == bytes32(0) || version.active || callPolicies[id][target][selector].active) {
            revert Invalid();
        }
        if (maxDataLength < 4 || (amountArg != type(uint8).max && maxAmount == 0)) revert Invalid();
        callCodeHashes[id][target][selector] = target.codehash;
        callPolicies[id][target][selector] =
            CallPolicy(target.codehash, maxDataLength, recipientArg, amountArg, maxAmount, true);
        callCount[id] += 1;
        emit CallRegistered(id, target, selector);
    }

    function isCallAllowed(bytes32 id, address target, bytes4 selector) external view returns (bool) {
        Version memory version = versions[id];
        return version.active && !version.frozen && callPolicies[id][target][selector].active
            && target.codehash == callCodeHashes[id][target][selector];
    }

    function validateCall(bytes32 id, address target, bytes calldata data, address account, uint256 drawAmount)
        external
        view
        returns (bool)
    {
        if (data.length < 4) return false;
        bytes4 selector = bytes4(data[:4]);
        Version memory version = versions[id];
        CallPolicy memory policy = callPolicies[id][target][selector];
        if (
            !version.active || version.frozen || !policy.active || target.codehash != policy.codeHash
                || data.length > policy.maxDataLength
        ) return false;
        if (policy.amountArg == type(uint8).max && policy.maxAmount != 0 && drawAmount > policy.maxAmount) {
            return false;
        }
        if (policy.amountArg != type(uint8).max) {
            uint256 amountArg = policy.amountArg;
            if (data.length < 4 + amountArg * 32 + 32) return false;
            uint256 amount;
            assembly {
                amount := calldataload(add(data.offset, add(4, mul(amountArg, 32))))
            }
            if (amount > policy.maxAmount) return false;
        }
        if (policy.recipientArg != type(uint8).max) {
            uint256 recipientArg = policy.recipientArg;
            if (data.length < 4 + recipientArg * 32 + 32) return false;
            uint256 recipient;
            assembly {
                recipient := calldataload(add(data.offset, add(4, mul(recipientArg, 32))))
            }
            if (address(uint160(recipient)) != account) return false;
        }
        return true;
    }

    function callCodeHash(bytes32 id, address target, bytes4 selector) external view returns (bytes32) {
        return callCodeHashes[id][target][selector];
    }
}
