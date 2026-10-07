// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

interface IGuardianPausable {
    function setPaused(bool value) external;
}

contract Guardian is ProxyInitializable {
    address public guardian;
    address public governance;
    mapping(address => bool) public paused;

    error Unauthorized();
    error PauseFailed();

    event PausedSet(address indexed target, bool value);

    constructor(address guardian_, address governance_) {
        if (!(
            guardian_ == address(0)
            && governance_ == address(0)
        )) {
            _initializeGuardian(guardian_, governance_);
        }
    }

    function initialize(address guardian_, address governance_) external initializer {
        _initializeGuardian(guardian_, governance_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.Guardian.v1");
    }

    function _initializeGuardian(address guardian_, address governance_) private {
        if (guardian_ == address(0) || governance_ == address(0)) revert Unauthorized();
        guardian = guardian_;
        governance = governance_;
    }

    function setPaused(address target, bool value) external {
        if (target == address(0)) revert Unauthorized();
        if (value) {
            if (msg.sender != guardian) revert Unauthorized();
        } else if (msg.sender != governance) {
            revert Unauthorized();
        }
        _setPaused(target, value);
    }

    function pause(address target) external {
        if (msg.sender != guardian || target == address(0)) revert Unauthorized();
        _setPaused(target, true);
    }

    function unpause(address target) external {
        if (msg.sender != governance || target == address(0)) revert Unauthorized();
        _setPaused(target, false);
    }

    function _setPaused(address target, bool value) internal {
        try IGuardianPausable(target).setPaused(value) {}
        catch {
            revert PauseFailed();
        }
        paused[target] = value;
        emit PausedSet(target, value);
    }
}
