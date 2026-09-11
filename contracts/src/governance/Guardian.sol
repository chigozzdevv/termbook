// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGuardianPausable {
    function setPaused(bool value) external;
}

contract Guardian {
    address public immutable guardian;
    mapping(address => bool) public paused;
    error Unauthorized();
    error PauseFailed();
    event PausedSet(address indexed target, bool value);

    constructor(address guardian_) {
        if (guardian_ == address(0)) revert Unauthorized();
        guardian = guardian_;
    }

    function setPaused(address target, bool value) external {
        if (msg.sender != guardian || target == address(0)) revert Unauthorized();
        try IGuardianPausable(target).setPaused(value) {} catch {
            revert PauseFailed();
        }
        paused[target] = value;
        emit PausedSet(target, value);
    }
}
