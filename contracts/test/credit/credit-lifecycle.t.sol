// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {Types} from "../../src/shared/Types.sol";

contract CreditLifecycleTest is Test {
    TermbookCore core;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;
    address house;
    address borrower;

    function setUp() public {
        core = new TermbookCore(address(this), address(this), address(0));
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
    }

    function _accept(bytes32 id, bytes32 intentId, uint256 limit) internal {
        bytes32 bundle = bytes32("b");
        bytes32 terms = keccak256("terms");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        uint256 nonce = uint256(intentId);
        uint256 expiry = block.timestamp + 1 days;
        bytes32 digest = keccak256(abi.encode(core.domain(), intentId, borrower, house, limit, nonce, expiry, terms));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.startPrank(borrower);
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        core.accept(id, intentId, borrower, house, address(3), limit, maturity, true, bundle, setupDeadline, 1 days, terms, nonce, expiry, abi.encodePacked(r, s, v));
        vm.stopPrank();
    }

    function _draw(bytes32 id, uint256 amount, uint256 bnonce) internal {
        uint256 rev = core.creditRevision(id);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), id, amount, amount, bnonce, deadline, rev));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(id, amount, amount, bnonce, deadline, abi.encodePacked(r, s, v));
    }

    function testAcceptToReady() public {
        bytes32 id = keccak256("c1");
        _accept(id, keccak256("i1"), 1000);
    }

    function testDrawRepay() public {
        bytes32 id = keccak256("c2");
        _accept(id, keccak256("i2"), 1000);
    }

    function testClose() public {
        bytes32 id = keccak256("c3");
        _accept(id, keccak256("i3"), 1000);
    }

    function testReplayIntentReverts() public {
        bytes32 intentId = keccak256("i4");
        _accept(keccak256("c4"), intentId, 1000);
    }

    function testBadSigReverts() public {
        bytes32 id = keccak256("c6");
        bytes32 intentId = keccak256("i6");
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        core.accept(id, intentId, borrower, house, address(3), 1000, block.timestamp + 30 days, true, bytes32("b"), block.timestamp + 1 days, 1 days, keccak256("t"), 999, block.timestamp + 1 days, hex"00");
    }
}
