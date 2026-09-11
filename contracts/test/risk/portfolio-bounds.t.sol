// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntegrationRegistry} from "../../src/integration/IntegrationRegistry.sol";

contract PortfolioBoundsTest is Test {
    function testApproveAndRead() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        r.approve(bytes32("bundle"), bytes32("hash"));
        (bytes32 h, bool active,) = r.versions(bytes32("bundle"));
        assertEq(h, bytes32("hash"));
        assertTrue(active);
    }
}
