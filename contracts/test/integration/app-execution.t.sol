// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AppGateway} from "../../src/integration/AppGateway.sol";
import {MockSettlementReceiver} from "../MockSettlementReceiver.sol";

contract AppExecutionTest is Test {
    function testUnknownCapabilityReverts() public {
        AppGateway g = new AppGateway(address(this));
        vm.expectRevert(AppGateway.Unknown.selector);
        g.buildCall(bytes32("nope"), "");
    }

    function testRegisteredCall() public {
        AppGateway g = new AppGateway(address(this));
        MockSettlementReceiver target = new MockSettlementReceiver();
        g.setCall(bytes32("swap"), address(target), MockSettlementReceiver.onSettlement.selector);
        (address t,) = g.buildCall(bytes32("swap"), hex"11");
        assertEq(t, address(target));
    }
}
