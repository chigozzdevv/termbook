// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract OracleRegistry {
    address public governance;
    mapping(bytes32 => address) public feeds;
    mapping(bytes32 => uint256) public maxAge;
    mapping(bytes32 => uint8) public feedDecimals;
    mapping(bytes32 => bool) public active;

    event FeedSet(bytes32 indexed id, address feed, uint256 maxAge, uint8 decimals);
    event FeedDisabled(bytes32 indexed id);

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
        feeds[id] = feed;
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

    function read(bytes32 id) external view returns (uint256 value, uint256 updatedAt, uint80 roundId) {
        address feed = feeds[id];
        uint256 age = maxAge[id];
        uint8 expectedDecimals = feedDecimals[id];
        if (!active[id] || feed.code.length == 0 || age == 0) revert InvalidFeed();
        uint8 decimals = IAggregatorV3(feed).decimals();
        if (decimals != expectedDecimals) revert InvalidFeed();
        (uint80 round, int256 answer,, uint256 updated, uint80 answeredInRound) = IAggregatorV3(feed).latestRoundData();
        if (
            answer <= 0 || updated == 0 || updated > block.timestamp || block.timestamp - updated > age
                || answeredInRound < round
        ) revert StaleFeed();
        uint256 unsignedAnswer = uint256(answer);
        if (decimals < 18) value = unsignedAnswer * (10 ** (18 - decimals));
        else value = unsignedAnswer / (10 ** (decimals - 18));
        updatedAt = updated;
        roundId = round;
    }
}
