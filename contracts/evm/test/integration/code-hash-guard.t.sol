// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CodeHashGuard} from "../../src/monad/integration/CodeHashGuard.sol";

contract CodeHashGuardTest is Test {
    address private constant TARGET = address(0x1234);

    function testPinsOnlyTheReviewedImmutableRuntime() public {
        vm.etch(TARGET, hex"60006000f3");
        CodeHashGuard guard = new CodeHashGuard(TARGET);
        assertTrue(guard.valid(TARGET));
        assertFalse(guard.valid(address(0x5678)));
        vm.etch(TARGET, hex"60016000f3");
        assertFalse(guard.valid(TARGET));
    }

    function testRejectsMissingAndDelegatingTargets() public {
        vm.expectRevert(CodeHashGuard.Invalid.selector);
        new CodeHashGuard(TARGET);
        vm.etch(TARGET, hex"60006000f4");
        vm.expectRevert(CodeHashGuard.Invalid.selector);
        new CodeHashGuard(TARGET);
    }

    function testRejectsDisappearingCode() public {
        vm.etch(TARGET, hex"60006000f3");
        CodeHashGuard guard = new CodeHashGuard(TARGET);
        vm.etch(TARGET, hex"");
        assertFalse(guard.valid(TARGET));
    }
}
