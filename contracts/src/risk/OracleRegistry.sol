// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract OracleRegistry {
    address public governance;
    mapping(bytes32 => address) public feeds;
    mapping(bytes32 => uint256) public maxAge;

    event FeedSet(bytes32 indexed id, address feed);

    constructor(address governance_) {
        require(governance_ != address(0), "invalid-governance");
        governance = governance_;
    }

    function setFeed(bytes32 id, address feed, uint256 maxAge_) external {
        require(msg.sender == governance && id != bytes32(0) && feed.code.length > 0 && maxAge_ > 0, "invalid-feed");
        feeds[id] = feed;
        maxAge[id] = maxAge_;
        emit FeedSet(id, feed);
    }
}
