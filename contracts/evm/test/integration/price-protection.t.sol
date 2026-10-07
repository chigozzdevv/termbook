// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "../MockERC20.sol";
import {Test} from "forge-std/Test.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";
import {OracleRegistry} from "../../src/monad/risk/OracleRegistry.sol";
import {IAppDeploymentGuard} from "../../src/monad/integration/IAppDeploymentGuard.sol";

contract PriceFeedFixture {
    uint80 public round = 1;
    mapping(uint80 => int256) public answers;
    mapping(uint80 => uint256) public timestamps;
    bool public permission = true;
    function decimals() external pure returns (uint8) { return 8; }
    function update(int256 answer) external { answers[++round] = answer; timestamps[round] = block.timestamp; }
    function setPermission(bool value) external { permission = value; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, answers[round], timestamps[round], timestamps[round], round);
    }
    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (id, answers[id], timestamps[id], timestamps[id], id);
    }
    function trade(uint256, uint256) external {}
}
contract PriceFeedGuardFixture is IAppDeploymentGuard {
    PriceFeedFixture public immutable feed;
    bytes32 public immutable codeHash;
    constructor(PriceFeedFixture feed_) { feed = feed_; codeHash = address(feed_).codehash; }
    function valid(address dependency) external view returns (bool) {
        return dependency == address(feed) && dependency.codehash == codeHash && feed.permission();
    }
}

contract SpotTokenFixture is MockERC20 { constructor() { decimals = 6; } }

contract PriceProtectionTest is Test {
    PriceProtection protection;
    OracleRegistry oracle;
    PriceFeedFixture feed;
    bytes32 bundle = keccak256("bundle");
    bytes32 capability = keccak256("place_order");
    bytes32 market = keccak256("ETH");
    bytes32 credit = keccak256("credit");
    bytes32 feedId = keccak256("ETH/USD");
    function setUp() public {
        vm.warp(1_000);
        protection = new PriceProtection(address(this));
        oracle = new OracleRegistry(address(this));
        feed = new PriceFeedFixture();
        feed.update(2000e8);
        oracle.setFeed(feedId, address(feed), 300, 8);
        oracle.setFeedGuard(feedId, address(new PriceFeedGuardFixture(feed)));
        protection.configure(bundle, capability, market, PriceProtection.Rule(address(oracle), feedId,
            address(feed), feed.trade.selector, 0, 8, 1, 0, 100, 500, 60, 1, 2));
        protection.bindCredit(credit, bundle, 75);
    }
    function _action(bool isMax, uint256 bound) internal view returns (ExecutionTypes.Action memory action) {
        action.capability = capability; action.market = market;
        action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(feed), address(0), 0,
            abi.encodeCall(feed.trade, (isMax ? 1 : 2, bound)), 0);
    }
    function _quote(bool isMax) internal view returns (PriceProtection.Quote memory quote) {
        (uint256 refPrice, uint256 updated, uint80 round) = oracle.read(feedId);
        quote = PriceProtection.Quote(round, refPrice, updated, block.timestamp,
            protection.deriveBound(refPrice, 50, isMax, 8), 50, isMax);
    }
    function _spot(bool maxInput) internal returns (ExecutionTypes.Action memory action, PriceProtection.Quote memory quote, SpotTokenFixture token) {
        token = new SpotTokenFixture();
        bytes32 spotBundle = keccak256(abi.encode("spot", maxInput));
        PriceProtection.Rule memory config = protection.rule(bundle, capability, market);
        PriceProtection.AmountRule memory amount = PriceProtection.AmountRule(0, maxInput ? 6 : 18, maxInput ? 18 : 6,
            maxInput, maxInput, true, maxInput ? address(token) : address(0), maxInput ? address(0) : address(token));
        protection.configureAmountRule(spotBundle, capability, market, config, amount, address(0));
        protection.bindCredit(keccak256("spot credit"), spotBundle, 75);
        quote = _quote(maxInput);
        quote.bound = protection.deriveAmountBound(quote.referencePrice, 1 ether, 50, amount.inputDecimals, amount.outputDecimals, amount.inverse, maxInput);
        action = _action(maxInput, quote.bound);
        action.calls[0].data = abi.encodeCall(feed.trade, (1 ether, quote.bound));
        action.calls[0].nativeValue = maxInput ? 0 : 1 ether;
        action.calls[0].spendToken = maxInput ? address(token) : address(0);
        action.calls[0].spendAmount = maxInput ? quote.bound : 0;
    }
    function testSpotMinimumOutputUsesAmountAndDecimalsAndActualReceipt() public {
        (ExecutionTypes.Action memory action, PriceProtection.Quote memory quote, SpotTokenFixture token) = _spot(false);
        bytes32 spotBundle = keccak256(abi.encode("spot", false));
        bytes32 spotCredit = keccak256("spot credit");
        assertEq(quote.bound, 1990e6);
        protection.validate(spotCredit, spotBundle, action, quote);
        address account = address(0xA);
        vm.deal(account, 1 ether);
        (uint256 beforeInput, uint256 beforeOutput) = protection.captureBalances(spotBundle, action, account, 0);
        vm.deal(account, 0); token.mint(account, quote.bound - 1);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validateAmountResult(spotBundle, action, account, 0, beforeInput, beforeOutput);
        token.mint(account, 1);
        protection.validateAmountResult(spotBundle, action, account, 0, beforeInput, beforeOutput);
        action.calls[0].data = abi.encodeCall(feed.trade, (2 ether, quote.bound));
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(spotCredit, spotBundle, action, quote);
    }
    function testSpotMaximumInputChecksOutputAndSpending() public {
        (ExecutionTypes.Action memory action, PriceProtection.Quote memory quote, SpotTokenFixture token) = _spot(true);
        bytes32 spotBundle = keccak256(abi.encode("spot", true));
        assertEq(quote.bound, 2010e6);
        protection.validate(keccak256("spot credit"), spotBundle, action, quote);
        address account = address(0xA);
        token.mint(account, quote.bound + 1);
        (uint256 beforeInput, uint256 beforeOutput) = protection.captureBalances(spotBundle, action, account, 0);
        vm.prank(account); token.transfer(address(1), quote.bound + 1);
        vm.deal(account, 1 ether);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validateAmountResult(spotBundle, action, account, 0, beforeInput, beforeOutput);
        token.mint(account, 1);
        protection.validateAmountResult(spotBundle, action, account, 0, beforeInput, beforeOutput);
        vm.deal(account, 1 ether - 1);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validateAmountResult(spotBundle, action, account, 0, beforeInput, beforeOutput);
    }
    function testSpotDirectionRoundingAndWideMultiplication() public {
        assertEq(protection.deriveAmountBound(2000e18, 100e6, 50, 6, 18, true, false), 0.04975 ether);
        assertEq(protection.deriveAmountBound(3e18, 1, 0, 18, 18, true, false), 1);
        assertEq(protection.deriveAmountBound(3e18, 1, 0, 18, 18, true, true), 3);
        assertEq(protection.deriveAmountBound(1e18, type(uint256).max, 0, 18, 18, false, false), type(uint256).max);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.deriveAmountBound(1e18, 0, 50, 6, 18, true, false);
    }
    function testPriceMovementCannotRecenterTheSignedBound() public {
        PriceProtection.Quote memory quote = _quote(true);
        ExecutionTypes.Action memory action = _action(true, quote.bound);
        vm.warp(1001); feed.update(2020e8);
        protection.validate(credit, bundle, action, quote);
        action = _action(true, protection.deriveBound(2020e18, 50, true, 8));
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(credit, bundle, action, quote);
    }
    function testBothDirectionsUseConservativeRoundingInApplicationUnits() public {
        PriceProtection.Quote memory quote = _quote(false);
        protection.validate(credit, bundle, _action(false, quote.bound), quote);
        assertEq(protection.deriveBound(1e18 + 1, 0, true, 8), 1e8);
        assertEq(protection.deriveBound(1e18 + 1, 0, false, 8), 1e8 + 1);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(credit, bundle, _action(true, quote.bound), quote);
    }
    function testHouseAndIntegrationCapsAndCalldataCannotBeBypassed() public {
        PriceProtection.Quote memory quote = _quote(true);
        quote.slippageBps = 76;
        quote.bound = protection.deriveBound(quote.referencePrice, 76, true, 8);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(credit, bundle, _action(true, quote.bound), quote);
        quote = _quote(true);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(credit, bundle, _action(true, quote.bound + 1), quote);
    }
    function testTighterSignedLimitPricesRetainHouseProtection() public {
        PriceProtection.Quote memory quote = _quote(true);
        quote.bound = 1900e8;
        protection.validate(credit, bundle, _action(true, quote.bound), quote);
        quote.bound = 2011e8;
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(credit, bundle, _action(true, quote.bound), quote);
        quote = _quote(false);
        quote.bound = 2100e8;
        protection.validate(credit, bundle, _action(false, quote.bound), quote);
        quote.bound = 1989e8;
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(credit, bundle, _action(false, quote.bound), quote);
    }
    function testStaleAuthorizationDeviationAndInvalidFeedGuardReject() public {
        PriceProtection.Quote memory quote = _quote(true);
        ExecutionTypes.Action memory action = _action(true, quote.bound);
        vm.warp(1061);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.validate(credit, bundle, action, quote);
        vm.warp(1001); feed.update(2200e8);
        vm.expectRevert(PriceProtection.Stale.selector);
        protection.validate(credit, bundle, action, quote);
        feed.setPermission(false);
        vm.expectRevert(OracleRegistry.InvalidFeed.selector);
        protection.validate(credit, bundle, action, quote);
    }
    function testFabricatedRoundAndReferenceAndLateRuleChangesReject() public {
        PriceProtection.Quote memory quote = _quote(true);
        ExecutionTypes.Action memory action = _action(true, quote.bound);
        quote.referencePrice += 1;
        vm.expectRevert(PriceProtection.Stale.selector);
        protection.validate(credit, bundle, action, quote);
        quote = _quote(true); quote.roundId = 123;
        vm.expectRevert(OracleRegistry.StaleFeed.selector);
        protection.validate(credit, bundle, action, quote);
        PriceProtection.Rule memory rule = protection.rule(bundle, capability, market);
        vm.expectRevert(PriceProtection.Invalid.selector);
        protection.configure(bundle, capability, keccak256("SOL"), rule);
    }
}
