// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlowExecutor} from "../../src/integration/FlowExecutor.sol";

contract AppRecoveryTest is Test {
    function testNonCoreBlocked() public {
        FlowExecutor f = new FlowExecutor(address(this));
        vm.prank(address(9));
        vm.expectRevert(FlowExecutor.Unauthorized.selector);
        f.runFlow(bytes32("c"), bytes32("f"), "");
    }
}
