// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LinkedLibraryGuard} from "../../src/monad/integration/LinkedLibraryGuard.sol";

contract LinkedDependency { function value() external pure returns (uint256) { return 1; } }
contract LinkedImplementation {
    address public immutable dependency;
    constructor(address linked) { dependency = linked; }
    function read() external returns (bytes memory) {
        (bool ok, bytes memory result) = dependency.delegatecall(abi.encodeWithSignature("value()"));
        require(ok);
        return result;
    }
}
contract LinkedProxy {
    address public implementation;
    constructor(address value) { implementation = value; }
    function upgrade(address value) external { implementation = value; }
}

contract LinkedLibraryGuardTest is Test {
    LinkedDependency dependency;
    LinkedImplementation implementation;
    LinkedProxy proxy;
    LinkedLibraryGuard guard;

    function setUp() public {
        dependency = new LinkedDependency();
        implementation = new LinkedImplementation(address(dependency));
        proxy = new LinkedProxy(address(implementation));
        address[] memory linked = new address[](1);
        linked[0] = address(dependency);
        guard = new LinkedLibraryGuard(address(proxy), address(implementation), proxy.implementation.selector, linked);
    }
    function testPinsProxyImplementationAndFixedLibrary() public view {
        assertTrue(guard.valid(address(proxy)));
        assertEq(guard.libraryAt(0), address(dependency));
        assertFalse(guard.valid(address(implementation)));
    }
    function testUpgradeOrLibraryCodeChangeInvalidatesGuard() public {
        proxy.upgrade(address(new LinkedImplementation(address(dependency))));
        assertFalse(guard.valid(address(proxy)));
        proxy.upgrade(address(implementation));
        vm.etch(address(dependency), hex"600160005500");
        assertFalse(guard.valid(address(proxy)));
    }
    function testUnreferencedOrDelegatingLibraryCannotBePinned() public {
        address[] memory linked = new address[](1);
        linked[0] = address(new LinkedDependency());
        vm.expectRevert(LinkedLibraryGuard.Invalid.selector);
        new LinkedLibraryGuard(address(proxy), address(implementation), proxy.implementation.selector, linked);
        linked[0] = address(dependency);
        vm.etch(address(dependency), hex"600060006000600060006000f400");
        vm.expectRevert(LinkedLibraryGuard.Invalid.selector);
        new LinkedLibraryGuard(address(proxy), address(implementation), proxy.implementation.selector, linked);
    }
    function testDuplicateLibraryCannotBePinned() public {
        address[] memory linked = new address[](2);
        linked[0] = address(dependency);
        linked[1] = address(dependency);
        vm.expectRevert(LinkedLibraryGuard.Invalid.selector);
        new LinkedLibraryGuard(address(proxy), address(implementation), proxy.implementation.selector, linked);
    }
}
