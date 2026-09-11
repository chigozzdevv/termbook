// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";

contract LateProofTest is Test {
    TermbookCore core;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;

    function setUp() public {
        core = new TermbookCore(address(this), address(this), address(0));
    }

    function testLateReturnTracked() public {
        bytes32 id = keccak256("late");
        bytes32 intentId = keccak256("il");
        address borrower = vm.addr(borrowerKey);
        address house = vm.addr(houseKey);
        bytes32 terms = keccak256("t");
        uint256 expiry = block.timestamp + 1 days;
        bytes32 digest = keccak256(abi.encode(core.domain(), intentId, borrower, house, uint256(100), uint256(intentId), expiry, terms));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.startPrank(borrower);
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        core.accept(id, intentId, borrower, house, address(3), 100, block.timestamp + 1 days, true, bytes32("b"), block.timestamp + 1 days, 1 days, terms, uint256(intentId), expiry, abi.encodePacked(r, s, v));
        vm.stopPrank();
    }
}
