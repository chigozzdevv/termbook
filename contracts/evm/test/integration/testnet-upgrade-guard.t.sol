// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestnetUpgradeGuard} from "../../src/monad/integration/TestnetUpgradeGuard.sol";

contract MonitoredDependency { function value() external pure returns (uint256) { return 1; } }

contract TestnetUpgradeGuardTest is Test {
    TestnetUpgradeGuard guard;
    address proxy;
    address implementation;
    address monitor = address(100);
    address governance = address(200);
    bytes32 observedHash = keccak256("observed block");

    function setUp() public {
        vm.chainId(10143);
        vm.roll(100);
        vm.warp(1000);
        vm.setBlockhash(99, observedHash);
        proxy = address(new MonitoredDependency());
        implementation = address(new MonitoredDependency());
        guard = new TestnetUpgradeGuard(proxy, implementation, monitor, governance);
    }

    function _renew() private {
        vm.prank(monitor);
        guard.renew(99, observedHash, 999);
    }

    function testInitiallyClosedAndExpiryBlocksWithoutMonitor() public {
        assertFalse(guard.valid(proxy));
        _renew();
        assertTrue(guard.valid(proxy));
        assertFalse(guard.valid(implementation));
        vm.warp(1179);
        assertFalse(guard.valid(proxy));
    }

    function testUnauthorizedRenewalAndRevocationFail() public {
        vm.expectRevert(TestnetUpgradeGuard.Unauthorized.selector);
        guard.renew(99, observedHash, 999);
        vm.expectRevert(TestnetUpgradeGuard.Unauthorized.selector);
        guard.revoke();
    }

    function testRevocationIsPermanentForEitherAuthority() public {
        _renew();
        vm.prank(governance);
        guard.revoke();
        assertFalse(guard.valid(proxy));
        vm.prank(monitor);
        vm.expectRevert(TestnetUpgradeGuard.Invalid.selector);
        guard.renew(99, observedHash, 999);
    }

    function testObservationMustBeRecentCanonicalAndIncreasing() public {
        vm.startPrank(monitor);
        vm.expectRevert(TestnetUpgradeGuard.Invalid.selector);
        guard.renew(99, keccak256("fork"), 999);
        vm.expectRevert(TestnetUpgradeGuard.Invalid.selector);
        guard.renew(99, observedHash, 969);
        vm.expectRevert(TestnetUpgradeGuard.Invalid.selector);
        guard.renew(99, observedHash, 1001);
        guard.renew(99, observedHash, 999);
        vm.expectRevert(TestnetUpgradeGuard.Invalid.selector);
        guard.renew(99, observedHash, 1000);
        vm.stopPrank();
    }

    function testCodeChangesInvalidateAnUnexpiredLease() public {
        _renew();
        vm.etch(implementation, hex"600160005500");
        assertFalse(guard.valid(proxy));
        vm.prank(monitor);
        vm.expectRevert(TestnetUpgradeGuard.Invalid.selector);
        guard.renew(99, observedHash, 999);
    }

    function testGuardCannotDeployOrAuthorizeOnMainnet() public {
        _renew();
        vm.chainId(143);
        assertFalse(guard.valid(proxy));
        vm.expectRevert(TestnetUpgradeGuard.Invalid.selector);
        new TestnetUpgradeGuard(proxy, implementation, monitor, governance);
    }
}
