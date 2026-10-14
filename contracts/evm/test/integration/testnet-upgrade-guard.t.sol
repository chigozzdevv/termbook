// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TestnetUpgradeGuard} from "../../src/monad/integration/TestnetUpgradeGuard.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";

contract MonitoredDependency { function value() external pure returns (uint256) { return 1; } }

contract TestnetUpgradeGuardTest is Test {
    TestnetUpgradeGuard guard;
    address proxy;
    address implementation;
    address monitor = address(100);
    address governance = address(200);
    bytes32 observedHash = keccak256("observed block");
    IntegrationRegistry registry;
    bytes32 bundle = keccak256("testnet bundle");

    function setUp() public {
        vm.chainId(10143);
        vm.roll(100);
        vm.warp(1000);
        vm.setBlockhash(99, observedHash);
        proxy = address(new MonitoredDependency());
        implementation = address(new MonitoredDependency());
        guard = new TestnetUpgradeGuard(proxy, implementation, monitor, governance);
    }

    function _registry() private {
        registry = new IntegrationRegistry(governance);
        _renew();
        vm.startPrank(governance);
        registry.approve(bundle, keccak256("definition"));
        registry.pinDependency(bundle, proxy);
        registry.setDependencyGuard(bundle, proxy, address(guard));
        vm.stopPrank();
        vm.warp(1179);
    }

    function _renew() private {
        vm.prank(monitor);
        guard.renew(99, observedHash, 999);
    }

    function testTestnetLeaseOverrideKeepsCodeAndRevocationChecks() public {
        _registry();
        assertFalse(registry.dependenciesValid(bundle));
        vm.prank(governance);
        registry.setTestnetGuardLeaseDisabled(bundle, proxy, true);
        vm.warp(10_000);
        assertTrue(registry.dependenciesValid(bundle));
        vm.etch(implementation, hex"600160005500");
        assertFalse(registry.dependenciesValid(bundle));
    }

    function testTestnetLeaseOverrideCannotBypassRevocationOrProxyChanges() public {
        _registry();
        vm.prank(governance);
        registry.setTestnetGuardLeaseDisabled(bundle, proxy, true);
        bytes memory original = proxy.code;
        vm.etch(proxy, hex"600160005500");
        assertFalse(registry.dependenciesValid(bundle));
        vm.etch(proxy, original);
        vm.prank(governance);
        guard.revoke();
        assertFalse(registry.dependenciesValid(bundle));
        vm.prank(governance);
        vm.expectRevert(IntegrationRegistry.Invalid.selector);
        registry.setTestnetGuardLeaseDisabled(bundle, proxy, true);
    }

    function testTestnetLeaseOverrideIsScopedAuthorizedAndReversible() public {
        _registry();
        vm.expectRevert(IntegrationRegistry.Unauthorized.selector);
        registry.setTestnetGuardLeaseDisabled(bundle, proxy, true);
        vm.prank(governance);
        registry.setTestnetGuardLeaseDisabled(bundle, proxy, true);
        assertTrue(registry.dependenciesValid(bundle));
        assertFalse(registry.dependencyValid(keccak256("other bundle"), proxy));
        vm.chainId(143);
        assertFalse(registry.dependenciesValid(bundle));
        vm.prank(governance);
        vm.expectRevert(IntegrationRegistry.Unauthorized.selector);
        registry.setTestnetGuardLeaseDisabled(bundle, proxy, true);
        vm.chainId(10143);
        vm.prank(governance);
        registry.setTestnetGuardLeaseDisabled(bundle, proxy, false);
        assertFalse(registry.dependenciesValid(bundle));
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
