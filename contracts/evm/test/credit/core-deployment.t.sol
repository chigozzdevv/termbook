// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";

contract CoreDeploymentTest is CoreFixture {
    function testHelpersArePermanentlyBoundToCore() external {
        TermbookCore core = _deployCore(address(this), address(this), address(0));
        assertEq(core.executionManager().core(), address(core));
        assertEq(core.reservationManager().core(), address(core));
        assertEq(core.priceProtection().core(), address(core));
    }

    function testRejectsMissingHelpers() external {
        vm.expectRevert(TermbookCore.InvalidAuthority.selector);
        this.createCore(address(0), address(0), address(0));
    }

    function testRejectsEachIncorrectCoreBinding() external {
        for (uint256 wrong; wrong < 3; wrong++) {
            address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 3);
            address execution =
                deployCode("FlowExecutor.sol:FlowExecutor", abi.encode(wrong == 0 ? address(1) : predicted));
            address reservations = deployCode(
                "ReservationManager.sol:ReservationManager", abi.encode(wrong == 1 ? address(1) : predicted)
            );
            address prices =
                deployCode("PriceProtection.sol:PriceProtection", abi.encode(wrong == 2 ? address(1) : predicted));
            vm.expectRevert(TermbookCore.InvalidAuthority.selector);
            this.createCore(execution, reservations, prices);
        }
    }

    function createCore(address execution, address reservations, address prices) external returns (address core) {
        bytes memory init = abi.encodePacked(
            vm.getCode("TermbookCore.sol:TermbookCore"),
            abi.encode(address(this), address(this), address(0), execution, reservations, prices)
        );
        assembly ("memory-safe") {
            core := create(0, add(init, 32), mload(init))
            if iszero(core) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
    }
}
