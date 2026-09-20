// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract IntegrationRegistry {
    struct Version {
        bytes32 codeHash;
        bool active;
        bool frozen;
    }

    mapping(bytes32 => Version) public versions;
    mapping(bytes32 => mapping(address => mapping(bytes4 => bytes32))) public callCodeHashes;
    address public immutable reviewer;
    error Unauthorized();
    error Invalid();
    error Frozen();

    event VersionApproved(bytes32 indexed id, bytes32 codeHash);
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
        version.active = true;
        emit VersionApproved(id, codeHash);
    }

    function freeze(bytes32 id) external {
        if (msg.sender != reviewer) revert Unauthorized();
        versions[id].frozen = true;
        versions[id].active = false;
        emit VersionFrozen(id);
    }

    function registerCall(bytes32 id, address target, bytes4 selector) external {
        if (msg.sender != reviewer || target == address(0) || target.code.length == 0 || selector == bytes4(0)) {
            revert Invalid();
        }
        Version memory version = versions[id];
        if (!version.active || version.frozen) revert Frozen();
        callCodeHashes[id][target][selector] = target.codehash;
        emit CallRegistered(id, target, selector);
    }

    function isCallAllowed(bytes32 id, address target, bytes4 selector) external view returns (bool) {
        Version memory version = versions[id];
        return version.active && !version.frozen && callCodeHashes[id][target][selector] != bytes32(0)
            && target.codehash == callCodeHashes[id][target][selector];
    }

    function callCodeHash(bytes32 id, address target, bytes4 selector) external view returns (bytes32) {
        return callCodeHashes[id][target][selector];
    }
}
