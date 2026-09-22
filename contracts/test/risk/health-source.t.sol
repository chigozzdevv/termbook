// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HealthSource} from "../../src/risk/HealthSource.sol";
import {IHealthReader, HealthReading} from "../../src/risk/IHealthSource.sol";
import {OracleRegistry, IAggregatorV3} from "../../src/risk/OracleRegistry.sol";
import {Types} from "../../src/shared/Types.sol";

contract MockAggregator is IAggregatorV3 {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
        roundId = 1;
    }

    function setAnswer(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
        roundId += 1;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}

contract MockHealthReader is IHealthReader {
    HealthReading internal reading;
    bytes32 public immutable priceId;

    constructor(bytes32 priceId_) {
        priceId = priceId_;
    }

    function setReading(HealthReading calldata reading_) external {
        reading = reading_;
    }

    function readHealth(bytes32, uint256, uint256, address oracleRegistry)
        external
        view
        returns (HealthReading memory)
    {
        OracleRegistry(oracleRegistry).read(priceId);
        return reading;
    }
}

contract HealthSourceTest is Test {
    bytes32 bundleId = keccak256("bundle");
    bytes32 creditId = keccak256("credit");
    bytes32 priceId = keccak256("price");
    OracleRegistry oracle;
    HealthSource source;
    MockAggregator feed;
    MockHealthReader reader;

    function setUp() public {
        oracle = new OracleRegistry(address(this));
        source = new HealthSource(address(this), address(oracle));
        feed = new MockAggregator(8, 123_00000000);
        reader = new MockHealthReader(priceId);
        oracle.setFeed(priceId, address(feed), 1 days, 8);
        source.setReader(bundleId, address(reader), 3, 1 days);
    }

    function testSnapshotUsesFreshApprovedOracleAndComputesHealth() public {
        reader.setReading(HealthReading(500, 200, 1_000, 400, 10_000, 5_000, 50, block.timestamp));
        Types.HealthSnapshot memory result = source.snapshot(creditId, bundleId, 4, 500);
        assertEq(result.debt, 500);
        assertEq(result.recoveryValue, 1_400);
        assertEq(result.healthBps, 25_454);
    }

    function testStaleOracleBlocksHealthRefresh() public {
        reader.setReading(HealthReading(500, 200, 1_000, 400, 10_000, 5_000, 50, block.timestamp));
        vm.warp(3 days);
        feed.setAnswer(123_00000000, block.timestamp - 2 days);
        vm.expectRevert(OracleRegistry.StaleFeed.selector);
        source.snapshot(creditId, bundleId, 4, 500);
    }

    function testReaderFreshnessAndDebtAreBound() public {
        reader.setReading(HealthReading(499, 200, 1_000, 400, 10_000, 5_000, 50, block.timestamp));
        vm.expectRevert(HealthSource.Stale.selector);
        source.snapshot(creditId, bundleId, 4, 500);
    }

    function testReaderCannotChangeForExistingBundle() public {
        MockHealthReader replacement = new MockHealthReader(priceId);
        vm.expectRevert(HealthSource.Invalid.selector);
        source.setReader(bundleId, address(replacement), 4, 1 days);
        source.disable(bundleId);
        vm.expectRevert(HealthSource.Invalid.selector);
        source.setReader(bundleId, address(replacement), 4, 1 days);
    }
}
