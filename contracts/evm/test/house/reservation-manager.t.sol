// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReservationManager} from "../../src/monad/house/ReservationManager.sol";
import {MockERC20} from "../MockERC20.sol";

contract ReservationManagerTest is Test {
    ReservationManager manager;
    address vault;
    address house = address(10);
    address borrower = address(11);
    bytes32 credit = keccak256("credit");
    bytes32 policyHash;
    uint256 limit = 1_000_000_000;

    function setUp() public {
        vm.warp(1000);
        manager = new ReservationManager(address(this));
        vault = address(new MockERC20());
        manager.configure(house, 1, ReservationManager.Policy(vault, 1 days, 100, 1, 2,
            2_000_000_000, 4_000_000_000, 10_000, 20_000, 30_000, 10_000, 100));
        policyHash = manager.policyHashes(house, 1);
    }
    function _reserve(bytes32 id) internal returns (uint256 bond) {
        bond = manager.minimumBond(house, 1, borrower, limit, 1 days);
        manager.reserve(id, house, 1, vault, borrower, limit, bond, block.timestamp + 1 days,
            ReservationManager.Authorization(policyHash, borrower, borrower));
    }
    function testBondScalesWithLimitDurationAndDisclosedCharges() public view {
        uint256 day = manager.minimumBond(house, 1, borrower, limit, 1 days);
        assertGt(day, manager.minimumBond(house, 1, borrower, limit / 2, 1 days));
        assertGt(day, manager.minimumBond(house, 1, borrower, limit, 12 hours));
    }
    function testReadinessRefundsUnusedBondWithoutReleasingFacilityLiquidity() public {
        uint256 bond = _reserve(credit);
        vm.warp(block.timestamp + 12 hours);
        (uint256 charge, uint256 refund, address recipient) = manager.settle(credit, ReservationManager.Outcome.Ready);
        assertEq(charge + refund, bond);
        assertGt(charge, 10_000);
        assertGt(refund, 0);
        assertEq(recipient, borrower);
        assertEq(manager.houseCount(house), 0);
        assertEq(manager.houseLimit(house), 0);
        vm.expectRevert(ReservationManager.Invalid.selector);
        manager.settle(credit, ReservationManager.Outcome.Ready);
    }
    function testOutstandingBorrowerReservationsCannotExhaustHouseCapacity() public {
        _reserve(credit);
        uint256 bond = manager.minimumBond(house, 1, borrower, limit, 1 days);
        vm.expectRevert(ReservationManager.OverLimit.selector);
        manager.reserve(keccak256("second"), house, 1, vault, borrower, limit, bond, block.timestamp + 1 days,
            ReservationManager.Authorization(policyHash, borrower, borrower));
        manager.settle(credit, ReservationManager.Outcome.Abandoned);
        assertEq(manager.abandonments(house, borrower), 1);
        uint256 oldFloor = manager.minimumBond(house, 1, address(12), limit, 1 days);
        assertEq(manager.minimumBond(house, 1, borrower, limit, 1 days), oldFloor + 10_000);
        _reserve(keccak256("second"));
    }
    function testExpiryChargesAreBoundedByTheAcceptedDeadline() public {
        uint256 bond = _reserve(credit);
        vm.warp(block.timestamp + 30 days);
        (uint256 charge, uint256 refund,) = manager.settle(credit, ReservationManager.Outcome.Expired);
        assertEq(charge, bond);
        assertEq(refund, 0);
    }
    function testProtocolFailureRefundsThePayerAndDoesNotPenalizeTheBorrower() public {
        uint256 bond = _reserve(credit);
        vm.warp(block.timestamp + 1 days);
        (uint256 charge, uint256 refund,) = manager.settle(credit, ReservationManager.Outcome.ProtocolFailure);
        assertEq(charge, 0);
        assertEq(refund, bond);
        assertEq(manager.abandonments(house, borrower), 0);
    }
    function testSponsorMustAuthorizeTheExactCreditPayerRecipientAndCap() public {
        address sponsor = address(13);
        uint256 bond = manager.minimumBond(house, 1, borrower, limit, 1 days);
        ReservationManager.Authorization memory auth = ReservationManager.Authorization(policyHash, sponsor, sponsor);
        vm.expectRevert(ReservationManager.Unauthorized.selector);
        manager.reserve(credit, house, 1, vault, borrower, limit, bond, block.timestamp + 1 days, auth);
        vm.prank(sponsor);
        manager.authorizeSponsor(credit, ReservationManager.SponsorGrant(borrower, vault, policyHash, sponsor, bond, block.timestamp + 300));
        assertEq(manager.reserve(credit, house, 1, vault, borrower, limit, bond, block.timestamp + 1 days, auth), sponsor);
        (,, address recipient) = manager.settle(credit, ReservationManager.Outcome.ProtocolFailure);
        assertEq(recipient, sponsor);
        vm.expectRevert(ReservationManager.Invalid.selector);
        manager.reserve(credit, house, 1, vault, borrower, limit, bond, block.timestamp + 1 days, auth);
    }
}
