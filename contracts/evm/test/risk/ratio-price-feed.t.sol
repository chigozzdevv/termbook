// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RatioPriceFeed} from "../../src/monad/risk/RatioPriceFeed.sol";

contract RatioOracle {
    struct Price { uint256 value; uint256 at; uint80 round; }
    mapping(bytes32 => Price) private prices;
    bool public available = true;

    function set(bytes32 id, uint256 value, uint256 at, uint80 round) external {
        prices[id] = Price(value, at, round);
    }

    function disable() external { available = false; }

    function read(bytes32 id) external view returns (uint256, uint256, uint80) {
        require(available, "feed-disabled");
        Price memory price = prices[id];
        return (price.value, price.at, price.round);
    }
}

contract RatioPriceFeedTest is Test {
    bytes32 constant BASE = keccak256("ETH/USD");
    bytes32 constant QUOTE = keccak256("USDC/USD");
    RatioOracle oracle;
    RatioPriceFeed feed;

    function setUp() public {
        vm.warp(1000);
        oracle = new RatioOracle();
        oracle.set(BASE, 2000e18, 990, 1);
        oracle.set(QUOTE, 1e18, 980, 1);
        feed = new RatioPriceFeed(address(oracle), BASE, QUOTE);
    }

    function testPriceUsesSettlementDenominationAndOldestObservation() public {
        oracle.set(QUOTE, 0.8e18, 980, 1);
        feed.update();
        (uint80 round, int256 answer,, uint256 at, uint80 answered) = feed.latestRoundData();
        assertEq(answer, 2500e18);
        assertEq(at, 980);
        assertEq(answered, round);
    }

    function testHistoricalRoundRemainsBoundAfterQuoteChanges() public {
        feed.update();
        oracle.set(QUOTE, 0.5e18, 999, 2);
        feed.update();
        (, int256 historical,, uint256 at,) = feed.getRoundData(1);
        (, int256 latest,,,) = feed.latestRoundData();
        assertEq(historical, 2000e18);
        assertEq(latest, 4000e18);
        assertEq(at, 980);
        assertEq(feed.latestRound(), 2);
    }

    function testDuplicateUpdateDoesNotMintAnotherRound() public {
        feed.update();
        vm.prank(address(0xB0B));
        assertEq(feed.update(), 1);
        assertEq(feed.latestRound(), 1);
    }

    function testLatestPriceRequiresRefreshAfterUnderlyingRoundChanges() public {
        feed.update();
        oracle.set(BASE, 1900e18, 999, 2);
        vm.expectRevert(RatioPriceFeed.Invalid.selector);
        feed.latestRoundData();
        (, int256 historical,,,) = feed.getRoundData(1);
        assertEq(historical, 2000e18);
        feed.update();
        (, int256 latest,,,) = feed.latestRoundData();
        assertEq(latest, 1900e18);
    }

    function testDisabledUnderlyingFeedInvalidatesCachedHistory() public {
        feed.update();
        oracle.disable();
        vm.expectRevert("feed-disabled");
        feed.getRoundData(1);
    }

    function testZeroAndFutureObservationsRejected() public {
        oracle.set(QUOTE, 0, 980, 1);
        vm.expectRevert(RatioPriceFeed.Invalid.selector);
        feed.update();
        oracle.set(QUOTE, 1e18, block.timestamp + 1, 1);
        vm.expectRevert(RatioPriceFeed.Invalid.selector);
        feed.update();
    }

    function testRegressionCannotReplaceAnAcceptedRound() public {
        oracle.set(BASE, 2000e18, 990, 2);
        feed.update();
        oracle.set(BASE, 1900e18, 999, 1);
        vm.expectRevert(RatioPriceFeed.Invalid.selector);
        feed.update();
        assertEq(feed.latestRound(), 1);
    }
}
