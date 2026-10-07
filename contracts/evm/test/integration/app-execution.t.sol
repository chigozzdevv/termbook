// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AppGateway} from "../../src/monad/integration/AppGateway.sol";
import {MockSettlementReceiver} from "../MockSettlementReceiver.sol";

contract AppExecutionTest is Test {
    function testDuplicateCapabilityCannotReplaceReviewedTarget() public {
        MockSettlementReceiver target = new MockSettlementReceiver();
        AppGateway.Rule[] memory rules = new AppGateway.Rule[](2);
        rules[0] = AppGateway.Rule(bytes32("swap"), address(target), MockSettlementReceiver.onSettlement.selector,
            0, type(uint16).max, type(uint16).max, address(0), type(uint16).max, 0, 0);
        rules[1] = rules[0];
        vm.expectRevert(AppGateway.Invalid.selector); new AppGateway(rules);
    }
    function testSpendWordCannotReplaceBoundAccountIdentity() public {
        MockSettlementReceiver target = new MockSettlementReceiver();
        AppGateway.Rule[] memory rules = new AppGateway.Rule[](1);
        rules[0] = AppGateway.Rule(bytes32("swap"), address(target), MockSettlementReceiver.onSettlement.selector,
            32, 0, type(uint16).max, address(target), 0, 100, 0);
        vm.expectRevert(AppGateway.Invalid.selector); new AppGateway(rules);
    }
}
