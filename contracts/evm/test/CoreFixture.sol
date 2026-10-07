// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TermbookCore} from "../src/monad/credit/TermbookCore.sol";

abstract contract CoreFixture is Test {
    function _deployCore(address governance, address guardian, address risk) internal virtual returns (TermbookCore core) {
        return TermbookCore(_deployCoreArtifact("TermbookCore.sol:TermbookCore", governance, guardian, risk));
    }

    function _deployCoreArtifact(string memory artifact, address governance, address guardian, address risk)
        internal
        returns (address core)
    {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 3);
        address execution = deployCode("FlowExecutor.sol:FlowExecutor", abi.encode(predicted));
        address reservations = deployCode("ReservationManager.sol:ReservationManager", abi.encode(predicted));
        address prices = deployCode("PriceProtection.sol:PriceProtection", abi.encode(predicted));
        core = deployCode(artifact, abi.encode(governance, guardian, risk, execution, reservations, prices));
        assertEq(address(core), predicted);
    }
}
