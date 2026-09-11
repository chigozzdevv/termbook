// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiskEngine} from "../../src/risk/RiskEngine.sol";
import {Types} from "../../src/shared/Types.sol";

contract RiskThresholdsTest is Test {
    RiskEngine engine;

    function setUp() public {
        engine = new RiskEngine(address(this));
    }

    function testBelowFloorRejected() public {
        vm.expectRevert("below-floor");
        engine.setThresholds(bytes32("c"), 15000, 13000, 10500);
    }

    function testLiquidatableState() public {
        bytes32 id = bytes32("c1");
        engine.setThresholds(id, 15000, 13000, 11500);
        Types.HealthSnapshot memory s = Types.HealthSnapshot(100, 10, 10, 0, 0, 0, 0, 10, 1000);
        engine.record(id, s);
        assertEq(uint256(engine.riskState(id)), uint256(Types.Risk.Liquidatable));
    }
}
