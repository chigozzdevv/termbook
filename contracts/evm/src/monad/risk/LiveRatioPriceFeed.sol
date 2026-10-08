// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRatioPriceOracle} from "./RatioPriceFeed.sol";

contract LiveRatioPriceFeed {
    IRatioPriceOracle public immutable oracle;
    bytes32 public immutable baseId;
    bytes32 public immutable quoteId;
    uint8 public constant decimals = 18;

    error Invalid();

    constructor(address oracle_, bytes32 baseId_, bytes32 quoteId_) {
        if (oracle_.code.length == 0 || baseId_ == bytes32(0) || quoteId_ == bytes32(0) || baseId_ == quoteId_) revert Invalid();
        oracle = IRatioPriceOracle(oracle_);
        baseId = baseId_;
        quoteId = quoteId_;
    }

    function latestRoundData() public view returns (uint80, int256, uint256, uint256, uint80) {
        (uint256 base, uint256 baseAt, uint80 baseRound) = oracle.read(baseId);
        (uint256 quote, uint256 quoteAt, uint80 quoteRound) = oracle.read(quoteId);
        if (base == 0 || quote == 0 || baseAt == 0 || quoteAt == 0 || baseAt > block.timestamp
            || quoteAt > block.timestamp || baseRound == 0 || quoteRound == 0) revert Invalid();
        uint256 answer = base * 1e18 / quote;
        if (answer == 0 || answer > uint256(type(int256).max)) revert Invalid();
        uint80 round = uint80(uint256(keccak256(abi.encode(baseRound, quoteRound))));
        if (round == 0) revert Invalid();
        uint256 updatedAt = baseAt < quoteAt ? baseAt : quoteAt;
        return (round, int256(answer), updatedAt, updatedAt, round);
    }

    function getRoundData(uint80 requested) external view returns (uint80, int256, uint256, uint256, uint80) {
        (uint80 round, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answered) = latestRoundData();
        if (requested != round) revert Invalid();
        return (round, answer, startedAt, updatedAt, answered);
    }
}
