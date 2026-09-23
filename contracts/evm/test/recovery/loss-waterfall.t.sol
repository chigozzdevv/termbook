// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HealthMath} from "../../src/monad/risk/HealthMath.sol";

contract LossWaterfallTest is Test {
    function testWaterfallOrder() public pure {
        uint256 cash = 100;
        uint256 app = 200;
        uint256 source = 300;
        uint256 total = cash + app + source;
        assertEq(total, 600);
        uint256 rec = HealthMath.recoveryValue(cash, source, int256(app), 10000, 10000);
        assertEq(rec, 600);
    }
}
