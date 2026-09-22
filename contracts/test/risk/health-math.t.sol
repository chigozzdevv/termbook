// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HealthMath} from "../../src/risk/HealthMath.sol";

contract HealthMathTest is Test {
    function testExampleFromSpec() public pure {
        uint256 rec = HealthMath.recoveryValue(100, 400, int256(600), 8000, 9000);
        assert(rec == 960);
        uint256 h = HealthMath.healthBps(960, 700, 20);
        assertGt(h, 13000);
        assertLt(h, 13600);
    }

    function testNegativeAppDeducted() public pure {
        int256 v = HealthMath.applicationValue(-50, 9000);
        assert(v == -50);
    }

    function testRemainingRecoveryCostIsCountedOnce() public pure {
        uint256 recovery = HealthMath.recoveryValue(100, 400, 8000, 600, 9000, 20);
        assertEq(recovery, 960);
        assertEq(HealthMath.healthBps(recovery, 700, 20), 13_333);
    }
}
