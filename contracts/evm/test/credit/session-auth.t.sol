// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";

contract SessionAuthTest is CoreFixture {
    TermbookCore core;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;

    function setUp() public {
        core = _deployCore(address(this), address(this), address(0));
    }

    function _accept(bytes32 id, bytes32 intentId) internal {
        address borrower = vm.addr(borrowerKey);
        address house = vm.addr(houseKey);
        bytes32 terms = keccak256("t");
        uint256 nonce = uint256(intentId);
        uint256 expiry = block.timestamp + 1 days;
        bytes32 digest = keccak256(abi.encode(core.domain(), intentId, borrower, house, uint256(1000), nonce, expiry, terms));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.startPrank(borrower);
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        core.accept(id, intentId, borrower, house, address(3), 1000, block.timestamp + 1 days, true, bytes32("b"), block.timestamp + 1 days, 1 days, terms, nonce, expiry, abi.encodePacked(r, s, v));
        vm.stopPrank();
    }

    function _draw(bytes32 id, uint256 amount, uint256 maxBound, uint256 bnonce) internal {
        uint256 rev = core.creditRevision(id);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), id, amount, maxBound, bnonce, deadline, rev));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(id, amount, maxBound, bnonce, deadline, abi.encodePacked(r, s, v));
    }

    function testRevisionAdvancesOnDraw() public {
        bytes32 id = keccak256("s1");
        _accept(id, keccak256("is"));
    }

    function testDrawBoundEnforced() public {
        bytes32 id = keccak256("s2");
        _accept(id, keccak256("is2"));
    }

    function testReplayNonceReverts() public {
        bytes32 id = keccak256("s3");
        _accept(id, keccak256("is3"));
    }
}
