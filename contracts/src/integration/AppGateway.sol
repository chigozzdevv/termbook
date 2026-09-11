// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AppGateway {
    struct Call {
        address target;
        bytes4 selector;
        bool active;
    }

    mapping(bytes32 => Call) public calls;
    address public immutable core;
    error Unauthorized();
    error Unknown();
    error InvalidTarget();

    constructor(address core_) {
        core = core_;
    }

    function setCall(bytes32 capability, address target, bytes4 selector) external {
        if (msg.sender != core) revert Unauthorized();
        if (target == address(0) || target.code.length == 0 || selector == bytes4(0)) revert InvalidTarget();
        calls[capability] = Call(target, selector, true);
    }

    function disable(bytes32 capability) external {
        if (msg.sender != core) revert Unauthorized();
        calls[capability].active = false;
    }

    function buildCall(bytes32 capability, bytes calldata params) external view returns (address target, bytes memory data) {
        Call memory c = calls[capability];
        if (!c.active) revert Unknown();
        return (c.target, abi.encodePacked(c.selector, params));
    }
}
