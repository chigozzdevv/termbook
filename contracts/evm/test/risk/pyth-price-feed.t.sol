// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PythPriceFeed, IPythPriceSource} from "../../src/monad/risk/PythPriceFeed.sol";

contract PythSourceMock is IPythPriceSource {
    Price private price;
    function set(int64 value, uint64 confidence, int32 exponent, uint256 timestamp) external {
        price = Price(value, confidence, exponent, timestamp);
    }
    function getPriceUnsafe(bytes32) external view returns (Price memory) { return price; }
}

contract PythPriceFeedTest is Test {
    PythSourceMock private source;
    PythPriceFeed private feed;
    function setUp() public {
        vm.warp(1000);
        source = new PythSourceMock();
        source.set(115_00000000, 10000000, -8, 999);
        feed = new PythPriceFeed(address(source), bytes32(uint256(1)), 60, 200);
    }
    function testNormalizesPriceAndUsesSignedTimestamp() public view {
        (uint80 round, int256 price,, uint256 updated, uint80 answered) = feed.latestRoundData();
        assertEq(price, 115e18);
        assertEq(updated, 999);
        assertEq(round, 999);
        assertEq(answered, round);
    }
    function testRejectsStaleFutureAndInvalidPrices() public {
        source.set(115_00000000, 1, -8, 939);
        vm.expectRevert(PythPriceFeed.InvalidPrice.selector); feed.latestRoundData();
        source.set(115_00000000, 1, -8, 1001);
        vm.expectRevert(PythPriceFeed.InvalidPrice.selector); feed.latestRoundData();
        source.set(-1, 1, -8, 999);
        vm.expectRevert(PythPriceFeed.InvalidPrice.selector); feed.latestRoundData();
        source.set(1, 0, -36, 999);
        vm.expectRevert(PythPriceFeed.InvalidPrice.selector); feed.latestRoundData();
    }
    function testRejectsWideConfidenceAndSourceChanges() public {
        source.set(100, 3, 0, 999);
        vm.expectRevert(PythPriceFeed.InvalidPrice.selector); feed.latestRoundData();
        vm.etch(address(source), hex"00");
        vm.expectRevert(PythPriceFeed.InvalidPrice.selector); feed.latestRoundData();
    }
    function testRejectsInventedHistoricalRound() public {
        vm.expectRevert(PythPriceFeed.InvalidPrice.selector); feed.getRoundData(998);
    }
    function testFuzzNormalization(int64 value, int32 exponent) public {
        value = int64(int256(bound(int256(value), 1, type(int64).max)));
        exponent = int32(int256(bound(int256(exponent), -18, 18)));
        source.set(value, 0, exponent, 999);
        (,int256 answer,,,) = feed.latestRoundData();
        assertEq(uint256(answer), uint256(uint64(value)) * 10 ** uint256(int256(exponent) + 18));
    }
}
