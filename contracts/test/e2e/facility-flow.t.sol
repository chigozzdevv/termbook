// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {Types} from "../../src/shared/Types.sol";
import {MockERC20} from "../MockERC20.sol";

contract FacilityFlowTest is Test {
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;

    function _accept(TermbookCore core, bytes32 id, bytes32 intentId) internal {
        address borrower = vm.addr(borrowerKey);
        address house = vm.addr(houseKey);
        bytes32 terms = keccak256("t");
        uint256 expiry = block.timestamp + 1 days;
        bytes32 digest = keccak256(abi.encode(core.domain(), intentId, borrower, house, uint256(1000), uint256(intentId), expiry, terms));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.startPrank(borrower);
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        core.accept(id, intentId, borrower, house, address(3), 1000, block.timestamp + 30 days, true, bytes32("b"), block.timestamp + 1 days, 1 days, terms, uint256(intentId), expiry, abi.encodePacked(r, s, v));
        vm.stopPrank();
    }

    function _draw(TermbookCore core, bytes32 id, uint256 amount, uint256 bnonce) internal {
        uint256 rev = core.creditRevision(id);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), id, amount, amount, bnonce, deadline, rev));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(id, amount, amount, bnonce, deadline, abi.encodePacked(r, s, v));
    }

    function testFullFlow() public {
        TermbookCore core = new TermbookCore(address(this), address(this), address(0));
        bytes32 id = keccak256("e2e");
        _accept(core, id, keccak256("ie"));
    }

    function testVaultDrawCycle() public {
        MockERC20 token = new MockERC20();
        HouseVault v = new HouseVault(address(token), address(this), address(this), address(0), address(0));
        token.mint(address(this), 2000);
        token.approve(address(v), 2000);
        v.deposit(address(this), 2000);
        v.reserve(bytes32(uint256(1)), 500);
        v.fundDraw(bytes32(uint256(1)), address(9), 500);
        token.mint(address(this), 500);
        token.approve(address(v), 500);
        v.receiveRepay(bytes32(uint256(1)), 500);
        assertEq(v.drawnPrincipal(), 0);
    }
}
