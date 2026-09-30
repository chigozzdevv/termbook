// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {Types} from "../../src/shared/Types.sol";

contract PartialRecoveryTest is CoreFixture {
    TermbookCore core;
    RiskEngine engine;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;

    function setUp() public {
        engine = new RiskEngine(address(this));
        core = _deployCore(address(this), address(this), address(engine));
        engine = RiskEngine(address(engine));
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
        core.accept(id, intentId, borrower, house, address(3), 1000, block.timestamp + 365 days, true, bytes32("b"), block.timestamp + 1 days, 1 days, terms, nonce, expiry, abi.encodePacked(r, s, v));
        vm.stopPrank();
    }

    function testCurePath() public {
        bytes32 id = keccak256("p1");
        _accept(id, keccak256("ip"));
    }
}
