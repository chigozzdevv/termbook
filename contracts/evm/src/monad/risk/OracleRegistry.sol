// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppDeploymentGuard} from "../integration/IAppDeploymentGuard.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IAggregatorRounds {
    function getRoundData(uint80 roundId) external view
        returns (uint80, int256, uint256, uint256, uint80);
}

contract OracleRegistry {
    address public governance;
    mapping(bytes32 => address) public feeds;
    mapping(bytes32 => uint256) public maxAge;
    mapping(bytes32 => uint8) public feedDecimals;
    mapping(bytes32 => bytes32) public feedCodeHash;
    mapping(bytes32 => bool) public active;
    mapping(bytes32 => address) public feedGuards;
    mapping(bytes32 => bytes32) public guardCodeHashes;

    event FeedSet(bytes32 indexed id, address feed, uint256 maxAge, uint8 decimals);
    event FeedDisabled(bytes32 indexed id);
    event FeedGuardSet(bytes32 indexed id, address guard);

    error Unauthorized();
    error InvalidFeed();
    error StaleFeed();

    constructor(address governance_) {
        require(governance_ != address(0), "invalid-governance");
        governance = governance_;
    }

    function setFeed(bytes32 id, address feed, uint256 maxAge_, uint8 decimals_) external {
        if (msg.sender != governance || id == bytes32(0) || feed.code.length == 0 || maxAge_ == 0) {
            revert InvalidFeed();
        }
        if (decimals_ > 36) revert InvalidFeed();
        if (feeds[id] != address(0)) revert InvalidFeed();
        feeds[id] = feed;
        feedCodeHash[id] = feed.codehash;
        maxAge[id] = maxAge_;
        feedDecimals[id] = decimals_;
        active[id] = true;
        emit FeedSet(id, feed, maxAge_, decimals_);
    }

    function disable(bytes32 id) external {
        if (msg.sender != governance) revert Unauthorized();
        active[id] = false;
        emit FeedDisabled(id);
    }

    function setFeedGuard(bytes32 id, address guard) external {
        if (msg.sender != governance) revert Unauthorized();
        if (feeds[id] == address(0) || feedGuards[id] != address(0) || guard.code.length == 0
            || CodeInspection.delegates(guard) || !IAppDeploymentGuard(guard).valid(feeds[id])) revert InvalidFeed();
        feedGuards[id] = guard;
        guardCodeHashes[id] = guard.codehash;
        emit FeedGuardSet(id, guard);
    }

    function read(bytes32 id) external view returns (uint256 value, uint256 updatedAt, uint80 roundId) {
        address feed = _feed(id);
        (uint80 round, int256 answer,, uint256 updated, uint80 answeredInRound) = IAggregatorV3(feed).latestRoundData();
        value = _normalize(id, round, answer, updated, answeredInRound);
        return (value, updated, round);
    }

    function readRound(bytes32 id, uint80 requested) external view returns (uint256 value, uint256 updatedAt, uint80 roundId) {
        address feed = _feed(id);
        (uint80 round, int256 answer,, uint256 updated, uint80 answeredInRound) = IAggregatorRounds(feed).getRoundData(requested);
        if (round != requested) revert InvalidFeed();
        value = _normalize(id, round, answer, updated, answeredInRound);
        return (value, updated, round);
    }

    function _feed(bytes32 id) private view returns (address feed) {
        feed = feeds[id];
        uint256 age = maxAge[id];
        uint8 expectedDecimals = feedDecimals[id];
        if (!active[id] || feed.code.length == 0 || feed.codehash != feedCodeHash[id] || age == 0) {
            revert InvalidFeed();
        }
        uint8 decimals = IAggregatorV3(feed).decimals();
        if (decimals != expectedDecimals) revert InvalidFeed();
        address guard = feedGuards[id];
        if (guard != address(0) && (guard.codehash != guardCodeHashes[id]
            || !IAppDeploymentGuard(guard).valid(feed))) revert InvalidFeed();
    }

    function _normalize(bytes32 id, uint80 round, int256 answer, uint256 updated, uint80 answeredInRound)
        private view returns (uint256 value) {
        if (
            round == 0 || answer <= 0 || updated == 0 || updated > block.timestamp || block.timestamp - updated > maxAge[id]
                || answeredInRound < round
        ) revert StaleFeed();
        uint256 unsignedAnswer = uint256(answer);
        uint8 decimals = feedDecimals[id];
        if (decimals < 18) value = unsignedAnswer * (10 ** (18 - decimals));
        else value = unsignedAnswer / (10 ** (decimals - 18));
        if (value == 0) revert InvalidFeed();
    }
}
