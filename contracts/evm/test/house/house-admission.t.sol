// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {HouseRegistry} from "../../src/monad/house/HouseRegistry.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";

contract HouseAdmissionTest is Test {
    MockERC20 token;
    TermbookCore core;
    HouseRegistry registry;
    HouseVault vault;
    RiskEngine risk;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;
    address house;
    address borrower;

    function setUp() public {
        token = new MockERC20();
        core = new TermbookCore(address(this), address(this), address(0));
        registry = new HouseRegistry(address(this));
        vault = new HouseVault(address(token), address(core), address(this), address(0), address(0));
        risk = new RiskEngine(address(core));
        core.setRisk(address(risk));
        core.setHouseRegistry(address(registry));
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        token.mint(address(this), 1_000);
        token.approve(address(vault), 1_000);
        vault.deposit(address(this), 1_000);
        registry.register(house, address(vault), address(token), address(this));
        registry.setPolicy(house, 1, 500, 1 days, 365 days, 10_000, 100, 1_000);
        registry.setRiskPolicy(house, 15_000, 13_000, 12_000, 11_500, 11_000);
    }

    function _accept(bytes32 creditId, bytes32 intentId, uint256 limit, address quotedHouse, bytes4 expectedError)
        internal
    {
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 31 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigestWithTerms(
            intentId,
            borrower,
            quotedHouse,
            address(vault),
            limit,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            0,
            1,
            expiry,
            termsHash,
            1_000,
            5,
            500
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.prank(borrower);
        if (expectedError != bytes4(0)) vm.expectRevert(expectedError);
        core.acceptWithTerms(
            creditId,
            intentId,
            borrower,
            quotedHouse,
            address(vault),
            limit,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            0,
            termsHash,
            1,
            expiry,
            1_000,
            5,
            500,
            abi.encodePacked(r, s, v)
        );
    }

    function testRegisteredHouseAndPolicyArePinned() public {
        bytes32 creditId = keccak256("credit");
        _accept(creditId, keccak256("intent"), 500, house, bytes4(0));
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        assertEq(credit.policyVersion, 1);
        assertEq(vault.creditCommitted(creditId), 500);
        assertEq(risk.initialBps(creditId), 15_000);
        assertEq(risk.liquidationBps(creditId), 11_000);
    }

    function testUnregisteredHouseCannotUseRegisteredVault() public {
        address otherHouse = vm.addr(0xD00D);
        _accept(keccak256("credit"), keccak256("intent"), 500, otherHouse, TermbookCore.InvalidVault.selector);
    }

    function testPolicyLimitIsEnforcedBeforeReservation() public {
        _accept(keccak256("credit"), keccak256("intent"), 501, house, TermbookCore.InvalidTerms.selector);
        assertEq(vault.creditCommitted(keccak256("credit")), 0);
    }

    function testOnlyHouseManagerCanChangePolicy() public {
        vm.prank(address(0xD00D));
        vm.expectRevert(HouseRegistry.Unauthorized.selector);
        registry.setPolicy(house, 2, 800, 1 days, 365 days, 10_000, 100, 1_000);
    }

    function testHouseRiskPolicyCannotCrossProtocolFloor() public {
        vm.expectRevert(HouseRegistry.Invalid.selector);
        registry.setRiskPolicy(house, 15_000, 13_000, 12_000, 10_500, 10_000);
    }
}
