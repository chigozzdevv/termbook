// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProtocolGovernance} from "../../src/monad/governance/ProtocolGovernance.sol";
import {Guardian} from "../../src/monad/governance/Guardian.sol";

contract PausableTarget {
    bool public paused;
    address public lastCaller;

    function setPaused(bool value) external {
        paused = value;
        lastCaller = msg.sender;
    }
}

contract TimelockTarget {
    uint256 public value;
    address public lastCaller;

    function setValue(uint256 value_) external {
        value = value_;
        lastCaller = msg.sender;
    }
}

contract GovernanceTest is Test {
    address governance = address(0xA11CE);
    address guardianSigner = address(0xB0B);
    ProtocolGovernance protocolGovernance;
    Guardian guardian;
    TimelockTarget target;
    PausableTarget pausable;

    function setUp() public {
        protocolGovernance = new ProtocolGovernance(governance);
        guardian = new Guardian(guardianSigner, governance);
        target = new TimelockTarget();
        pausable = new PausableTarget();
    }

    function testQueuedActionExecutesOnlyAfterDelay() public {
        bytes memory data = abi.encodeCall(TimelockTarget.setValue, (42));
        bytes32 salt = keccak256("value");
        bytes32 id = protocolGovernance.actionId(address(target), 0, data, salt);

        vm.prank(governance);
        protocolGovernance.queue(address(target), 0, data, salt);
        assertEq(protocolGovernance.queuedAt(id), block.timestamp + 2 days);

        vm.expectRevert(ProtocolGovernance.NotReady.selector);
        protocolGovernance.execute(address(target), 0, data, salt);

        vm.warp(block.timestamp + 2 days);
        protocolGovernance.execute(address(target), 0, data, salt);
        assertEq(target.value(), 42);
        assertEq(target.lastCaller(), address(protocolGovernance));
        assertTrue(protocolGovernance.executed(id));

        vm.expectRevert(ProtocolGovernance.NotReady.selector);
        protocolGovernance.execute(address(target), 0, data, salt);
    }

    function testOnlyGovernanceQueuesAndCanCancel() public {
        bytes memory data = abi.encodeCall(TimelockTarget.setValue, (7));
        bytes32 salt = keccak256("cancel");

        vm.expectRevert(ProtocolGovernance.Invalid.selector);
        protocolGovernance.queue(address(target), 0, data, salt);

        vm.prank(governance);
        protocolGovernance.queue(address(target), 0, data, salt);
        vm.prank(governance);
        protocolGovernance.cancel(address(target), 0, data, salt);
        assertEq(protocolGovernance.queuedAt(protocolGovernance.actionId(address(target), 0, data, salt)), 0);
    }

    function testGuardianCanPauseButOnlyGovernanceCanUnpause() public {
        vm.prank(guardianSigner);
        guardian.pause(address(pausable));
        assertTrue(pausable.paused());
        assertEq(pausable.lastCaller(), address(guardian));

        vm.prank(guardianSigner);
        vm.expectRevert(Guardian.Unauthorized.selector);
        guardian.unpause(address(pausable));

        vm.prank(governance);
        guardian.unpause(address(pausable));
        assertFalse(pausable.paused());
    }
}
