// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";

contract PortfolioTarget {
    function execute() external {}
}

contract PortfolioBoundsTest is Test {
    function testApproveAndRead() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        PortfolioTarget target = new PortfolioTarget();
        r.approve(bytes32("bundle"), bytes32("hash"));
        r.registerCall(
            bytes32("bundle"), address(target), PortfolioTarget.execute.selector, 4, type(uint8).max, type(uint8).max, 0
        );
        r.activate(bytes32("bundle"));
        (bytes32 h, bool active,) = r.versions(bytes32("bundle"));
        assertEq(h, bytes32("hash"));
        assertTrue(active);
    }
}
