// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRatioPriceOracle {
    function read(bytes32 id) external view returns (uint256, uint256, uint80);
}

contract RatioPriceFeed {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    IRatioPriceOracle public immutable oracle;
    bytes32 public immutable baseId;
    bytes32 public immutable quoteId;
    uint8 public constant decimals = 18;
    uint80 public latestRound;
    uint80 public baseRound;
    uint80 public quoteRound;
    mapping(uint80 => Round) private rounds;

    error Invalid();
    event AnswerUpdated(uint80 indexed roundId, int256 answer, uint256 updatedAt);

    constructor(address oracle_, bytes32 baseId_, bytes32 quoteId_) {
        if (oracle_.code.length == 0 || baseId_ == bytes32(0) || quoteId_ == bytes32(0) || baseId_ == quoteId_) revert Invalid();
        oracle = IRatioPriceOracle(oracle_);
        baseId = baseId_;
        quoteId = quoteId_;
    }

    function update() external returns (uint80) {
        (uint256 base, uint256 baseAt, uint80 baseRound_) = oracle.read(baseId);
        (uint256 quote, uint256 quoteAt, uint80 quoteRound_) = oracle.read(quoteId);
        if (base == 0 || quote == 0 || baseAt == 0 || quoteAt == 0
            || baseAt > block.timestamp || quoteAt > block.timestamp
            || baseRound_ == 0 || quoteRound_ == 0
            || baseRound_ < baseRound || quoteRound_ < quoteRound) revert Invalid();
        if (latestRound != 0 && baseRound_ == baseRound && quoteRound_ == quoteRound) return latestRound;
        uint256 answer = base * 1e18 / quote;
        if (answer == 0 || answer > uint256(type(int256).max)) revert Invalid();
        uint256 updatedAt = baseAt < quoteAt ? baseAt : quoteAt;
        if (updatedAt < rounds[latestRound].updatedAt) revert Invalid();
        baseRound = baseRound_;
        quoteRound = quoteRound_;
        uint80 round = ++latestRound;
        rounds[round] = Round(int256(answer), updatedAt);
        emit AnswerUpdated(round, int256(answer), updatedAt);
        return round;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        (,, uint80 currentBaseRound) = oracle.read(baseId);
        (,, uint80 currentQuoteRound) = oracle.read(quoteId);
        if (currentBaseRound != baseRound || currentQuoteRound != quoteRound) revert Invalid();
        return getRoundData(latestRound);
    }

    function getRoundData(uint80 round) public view returns (uint80, int256, uint256, uint256, uint80) {
        oracle.read(baseId);
        oracle.read(quoteId);
        Round memory data = rounds[round];
        if (round == 0 || data.updatedAt == 0) revert Invalid();
        return (round, data.answer, data.updatedAt, data.updatedAt, round);
    }
}
