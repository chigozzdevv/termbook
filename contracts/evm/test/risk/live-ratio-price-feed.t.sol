// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LiveRatioPriceFeed} from "../../src/monad/risk/LiveRatioPriceFeed.sol";

contract LiveRatioOracle {
    uint256 public base = 100e18;
    uint256 public quote = 1e18;
    uint80 public baseRound = 1;
    uint80 public quoteRound = 1;
    uint256 public timestamp;
    bool public unavailable;
    constructor() { timestamp = block.timestamp; }
    function update(uint256 price, uint256 at) external { base = price; timestamp = at; baseRound++; }
    function fail() external { unavailable = true; }
    function read(bytes32 id) external view returns (uint256, uint256, uint80) {
        require(!unavailable, "unavailable");
        return id == bytes32(uint256(1)) ? (base, timestamp, baseRound) : (quote, timestamp, quoteRound);
    }
}

contract LiveRatioPriceFeedTest is Test {
    LiveRatioOracle oracle;
    LiveRatioPriceFeed feed;
    function setUp() public {
        vm.warp(1000);
        oracle = new LiveRatioOracle();
        feed = new LiveRatioPriceFeed(address(oracle), bytes32(uint256(1)), bytes32(uint256(2)));
    }
    function testReadsNewPriceWithoutKeeperTransaction() public {
        (uint80 beforeRound, int256 answer,,, uint80 answered) = feed.latestRoundData();
        assertEq(answer, 100e18); assertEq(answered, beforeRound);
        oracle.update(120e18, 1000);
        (uint80 round, int256 next,,,) = feed.latestRoundData();
        assertEq(next, 120e18); assertTrue(round != beforeRound);
        vm.expectRevert(LiveRatioPriceFeed.Invalid.selector); feed.getRoundData(beforeRound);
        (uint80 actual,,,,) = feed.getRoundData(round); assertEq(actual, round);
    }
    function testRejectsUnavailableFutureAndZeroSources() public {
        oracle.update(0, 1000); vm.expectRevert(LiveRatioPriceFeed.Invalid.selector); feed.latestRoundData();
        oracle.update(100e18, 1001); vm.expectRevert(LiveRatioPriceFeed.Invalid.selector); feed.latestRoundData();
        oracle.update(100e18, 1000); oracle.fail(); vm.expectRevert(); feed.latestRoundData();
    }
}
