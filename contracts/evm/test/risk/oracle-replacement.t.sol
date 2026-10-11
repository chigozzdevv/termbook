// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleRegistry} from "../../src/monad/risk/OracleRegistry.sol";

contract ReplacementFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public timestamp;
    constructor(uint8 decimals_, int256 answer_, uint256 timestamp_) {
        decimals = decimals_; answer = answer_; timestamp = timestamp_;
    }
    function set(int256 answer_, uint256 timestamp_) external { answer = answer_; timestamp = timestamp_; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, timestamp, timestamp, 1);
    }
}

contract ReplacementGuard {
    address public immutable target;
    constructor(address target_) { target = target_; }
    function valid(address dependency) external view returns (bool) { return dependency == target; }
}

contract OracleReplacementTest is Test {
    bytes32 private constant ID = keccak256("USDC/USD");
    OracleRegistry private oracle;
    ReplacementFeed private previous;
    ReplacementFeed private replacement;

    function setUp() public {
        vm.warp(100_000);
        oracle = new OracleRegistry(address(this));
        previous = new ReplacementFeed(8, 1e8, block.timestamp - 10_000);
        replacement = new ReplacementFeed(18, 999_000_000_000_000_000, block.timestamp);
        oracle.setFeed(ID, address(previous), 90_000, 8);
        oracle.setFeedGuard(ID, address(new ReplacementGuard(address(previous))));
    }

    function testReplacesSourceAtomicallyAndRemovesPreviousGuard() public {
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(0));
        (uint256 price, uint256 updated,) = oracle.read(ID);
        assertEq(price, 999_000_000_000_000_000);
        assertEq(updated, block.timestamp);
        assertEq(oracle.maxAge(ID), 300);
        assertEq(oracle.feedGuards(ID), address(0));
        assertEq(oracle.guardCodeHashes(ID), bytes32(0));
        previous.set(-1, 0);
        (price,,) = oracle.read(ID);
        assertEq(price, 999_000_000_000_000_000);
        vm.warp(block.timestamp + 301);
        vm.expectRevert(OracleRegistry.StaleFeed.selector); oracle.read(ID);
    }

    function testRequiresGovernanceAndMatchingExistingSource() public {
        vm.prank(address(123));
        vm.expectRevert(OracleRegistry.Unauthorized.selector);
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(0));
        vm.expectRevert(OracleRegistry.InvalidFeed.selector);
        oracle.replaceFeed(ID, address(replacement), address(previous), 300, 8, address(0));
        oracle.disable(ID);
        vm.expectRevert(OracleRegistry.InvalidFeed.selector);
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(0));
    }

    function testRejectsStaleInvalidAndMismatchedReplacement() public {
        replacement.set(1e18, block.timestamp - 301);
        vm.expectRevert(OracleRegistry.StaleFeed.selector);
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(0));
        replacement.set(-1, block.timestamp);
        vm.expectRevert(OracleRegistry.StaleFeed.selector);
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(0));
        replacement.set(1e18, block.timestamp);
        vm.expectRevert(OracleRegistry.InvalidFeed.selector);
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 8, address(0));
        ReplacementGuard wrongGuard = new ReplacementGuard(address(previous));
        vm.expectRevert(OracleRegistry.InvalidFeed.selector);
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(wrongGuard));
        assertEq(oracle.feeds(ID), address(previous));
    }

    function testPinsReplacementCodeAndGuard() public {
        ReplacementGuard guard = new ReplacementGuard(address(replacement));
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(guard));
        vm.etch(address(guard), hex"00");
        vm.expectRevert(OracleRegistry.InvalidFeed.selector); oracle.read(ID);
    }

    function testAgeCanOnlyTightenAndMustStillAcceptCurrentPrice() public {
        vm.expectRevert(OracleRegistry.InvalidFeed.selector);
        oracle.replaceFeed(ID, address(previous), address(replacement), 90_001, 18, address(0));
        vm.expectRevert(OracleRegistry.StaleFeed.selector); oracle.tightenFeedAge(ID, 300);
        assertEq(oracle.maxAge(ID), 90_000);
        oracle.replaceFeed(ID, address(previous), address(replacement), 300, 18, address(0));
        oracle.tightenFeedAge(ID, 120);
        assertEq(oracle.maxAge(ID), 120);
        vm.expectRevert(OracleRegistry.InvalidFeed.selector); oracle.tightenFeedAge(ID, 300);
        vm.expectRevert(OracleRegistry.InvalidFeed.selector); oracle.tightenFeedAge(ID, 0);
        vm.prank(address(123)); vm.expectRevert(OracleRegistry.Unauthorized.selector); oracle.tightenFeedAge(ID, 60);
    }
}
