// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {HouseRegistry} from "../../src/monad/house/HouseRegistry.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {Types} from "../../src/shared/Types.sol";
import {ReservationManager} from "../../src/monad/house/ReservationManager.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {ExecutionPolicyFixture} from "../integration/execution-manager.t.sol";
import {MockAppCallValidator} from "../MockAppCallValidator.sol";
import {MockHealthSource} from "../MockHealthSource.sol";
import {MockExitVerifier, FundedPositionRecoveryAdapter, FundedPositionTarget} from "../integration/real-flow.t.sol";

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
    address sponsor;

    function setUp() public {
        token = new MockERC20();
        core = TermbookCore(deployCode("TermbookCore.sol:TermbookCore", abi.encode(address(this), address(this), address(0))));
        registry = new HouseRegistry(address(this));
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(token), address(core), address(this), address(0), address(0))));
        risk = new RiskEngine(address(core));
        core.setRisk(address(risk));
        core.setHouseRegistry(address(registry));
        bytes32 bundle = keccak256("bundle");
        ExecutionPolicyFixture policy = new ExecutionPolicyFixture(address(this));
        core.configureExecutionPolicy(bundle, address(policy), 2, 2, 300);
        IntegrationRegistry integrations = new IntegrationRegistry(address(this));
        integrations.approve(bundle, keccak256("manifest"));
        integrations.registerCall(bundle, address(policy), policy.noop.selector, 4, type(uint8).max, type(uint8).max, 0);
        integrations.registerRecoveryCall(bundle, address(policy), policy.noop.selector, 4, type(uint8).max);
        MockAppCallValidator validator = new MockAppCallValidator();
        integrations.setCallValidator(bundle, address(policy), policy.noop.selector, address(validator));
        integrations.setRecoveryCallValidator(bundle, address(policy), policy.noop.selector, address(validator));
        integrations.activate(bundle);
        core.setIntegrationRegistry(address(integrations));
        MockHealthSource health = new MockHealthSource();
        health.setReaderActive(bundle, true);
        core.setHealthSource(address(health));
        core.setExitVerifier(bundle, address(new MockExitVerifier()));
        core.setAppRecoveryAdapter(bundle, address(new FundedPositionRecoveryAdapter(new FundedPositionTarget(token))));
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        token.mint(address(this), 1_000);
        token.approve(address(vault), 1_000);
        vault.deposit(address(this), 1_000);
        registry.register(house, address(vault), address(token), address(this));
        registry.setPolicy(house, 1, 500, 1 days, 365 days, 10_000, 100, 1_000);
        registry.setRiskPolicy(house, 15_000, 13_000, 12_000, 11_500, 11_000);
        core.configureReservationPolicy(house, 1, ReservationManager.Policy(address(vault), 1 days, 100, 1, 10,
            500, 5_000, 1, 2, 3, 1, 100));
        token.mint(borrower, 100);
        vm.prank(borrower);
        token.approve(address(vault), 100);
    }

    function _accept(bytes32, bytes32 intentId, uint256 limit, address quotedHouse, bytes4 expectedError)
        internal returns (bytes32 creditId) {
        Types.Quote memory quote;
        quote.intentId = intentId;
        quote.borrower = borrower;
        quote.house = quotedHouse;
        quote.vault = address(vault);
        quote.settlementAsset = address(token);
        quote.limit = limit;
        quote.maturity = block.timestamp + 31 days;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.reservationBond = 10;
        quote.nonce = 1;
        quote.expiry = block.timestamp + 1 days;
        quote.termsHash = keccak256("terms");
        quote.aprBps = 1_000;
        quote.originationFee = 5;
        quote.commitmentFeeBps = 500;
        quote.reservationPolicyHash = core.reservationManager().policyHashes(house, 1);
        quote.bondPayer = sponsor;
        quote.bondRefundRecipient = sponsor;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quotedHouse == house ? houseKey : 0xD00D, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        creditId = keccak256(abi.encode(intentId, borrower, quotedHouse, uint256(1)));
        vm.prank(borrower);
        if (expectedError != bytes4(0)) vm.expectRevert(expectedError);
        core.acceptQuote(quote);
    }

    function testRegisteredHouseAndPolicyArePinned() public {
        bytes32 creditId = _accept(keccak256("credit"), keccak256("intent"), 500, house, bytes4(0));
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        assertEq(credit.policyVersion, 1);
        assertEq(vault.creditCommitted(creditId), 500);
        assertEq(risk.initialBps(creditId), 15_000);
        assertEq(risk.liquidationBps(creditId), 11_000);
    }

    function testAbandonmentChargesAndRefundPreserveSeparateBondAccounting() public {
        bytes32 creditId = _accept(bytes32(0), keccak256("intent"), 500, house, bytes4(0));
        assertEq(token.balanceOf(borrower), 90);
        assertEq(vault.bondCash(), 10);
        assertEq(vault.freeCash(), 500);
        assertEq(vault.totalAssets(), 1000);
        vm.prank(borrower);
        core.abort(creditId);
        assertEq(token.balanceOf(borrower), 98);
        assertEq(vault.bondCash(), 0);
        assertEq(vault.bondLiabilities(), 0);
        assertEq(vault.freeCash(), 1002);
        assertEq(vault.creditCommitted(creditId), 0);
        assertEq(core.reservationManager().houseCount(house), 0);
        assertEq(core.creditDebt(creditId), 0);
    }

    function testReadySettlesOnlyAcceptedChargesAndKeepsTheFacilityCommitment() public {
        bytes32 creditId = _accept(bytes32(0), keccak256("intent"), 500, house, bytes4(0));
        CollateralVault collateral = new CollateralVault(address(token), block.chainid, address(core));
        core.setLocalCollateralVault(address(collateral), address(collateral).codehash);
        vm.startPrank(borrower);
        token.approve(address(collateral), 50);
        core.setCollateral(creditId, address(collateral), borrower);
        collateral.lock(keccak256("lock"), creditId, borrower, 50, borrower);
        core.bindCollateral(creditId, keccak256("lock"));
        core.bindAccount(creditId, address(new CreditAccount(creditId, borrower, address(core))));
        vm.stopPrank();
        assertEq(vault.creditCommitted(creditId), 500);
        assertEq(vault.freeCash(), 501);
        assertEq(vault.totalAssets(), 1001);
        assertEq(vault.bondCash(), 0);
        assertEq(core.reservationManager().houseCount(house), 0);
        assertEq(token.balanceOf(borrower), 49);
    }

    function testAttestedProtocolFailureRefundsTheWholeBond() public {
        bytes32 creditId = _accept(bytes32(0), keccak256("intent"), 500, house, bytes4(0));
        core.markSetupProtocolFailure(creditId, keccak256("failure evidence"));
        vm.prank(borrower);
        core.abort(creditId);
        assertEq(token.balanceOf(borrower), 100);
        assertEq(vault.freeCash(), 1000);
        assertEq(core.reservationManager().abandonments(house, borrower), 0);
    }

    function testAuthorizedSponsorPaysAndReceivesTheUnusedBond() public {
        sponsor = address(0xD00D);
        bytes32 intent = keccak256("intent");
        bytes32 id = keccak256(abi.encode(intent, borrower, house, uint256(1)));
        token.mint(sponsor, 100);
        bytes32 hash = core.reservationManager().policyHashes(house, 1);
        vm.startPrank(sponsor);
        token.approve(address(vault), 10);
        core.reservationManager().authorizeSponsor(id, ReservationManager.SponsorGrant(borrower,
            address(vault), hash, sponsor, 10, block.timestamp + 1 days));
        vm.stopPrank();
        bytes32 creditId = _accept(bytes32(0), intent, 500, house, bytes4(0));
        assertEq(token.balanceOf(borrower), 100);
        assertEq(token.balanceOf(sponsor), 90);
        vm.prank(borrower);
        core.abort(creditId);
        assertEq(token.balanceOf(sponsor), 98);
        assertEq(token.balanceOf(borrower), 100);
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
