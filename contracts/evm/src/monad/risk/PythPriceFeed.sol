// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPythPriceSource {
    struct Price { int64 price; uint64 conf; int32 expo; uint256 publishTime; }
    function getPriceUnsafe(bytes32 id) external view returns (Price memory);
}

contract PythPriceFeed {
    IPythPriceSource public immutable pyth;
    bytes32 public immutable priceId;
    bytes32 public immutable sourceCodeHash;
    uint256 public immutable maxAge;
    uint256 public immutable maxConfidenceBps;
    uint8 public constant decimals = 18;

    error InvalidPrice();

    constructor(address pyth_, bytes32 priceId_, uint256 maxAge_, uint256 maxConfidenceBps_) {
        if (pyth_.code.length == 0 || priceId_ == bytes32(0) || maxAge_ == 0
            || maxConfidenceBps_ == 0 || maxConfidenceBps_ > 1000) revert InvalidPrice();
        pyth = IPythPriceSource(pyth_);
        priceId = priceId_;
        sourceCodeHash = pyth_.codehash;
        maxAge = maxAge_;
        maxConfidenceBps = maxConfidenceBps_;
    }

    function latestRoundData() public view returns (uint80, int256, uint256, uint256, uint80) {
        if (address(pyth).codehash != sourceCodeHash) revert InvalidPrice();
        IPythPriceSource.Price memory price = pyth.getPriceUnsafe(priceId);
        if (price.price <= 0 || price.expo < -36 || price.expo > 18 || price.publishTime == 0
            || price.publishTime > block.timestamp || block.timestamp - price.publishTime > maxAge
            || price.publishTime > type(uint80).max
            || uint256(price.conf) * 10_000 > uint256(uint64(price.price)) * maxConfidenceBps) revert InvalidPrice();
        uint256 value = uint256(uint64(price.price));
        int256 scale = int256(price.expo) + 18;
        if (scale >= 0) value *= 10 ** uint256(scale);
        else value /= 10 ** uint256(-scale);
        if (value == 0 || value > uint256(type(int256).max)) revert InvalidPrice();
        uint80 round = uint80(price.publishTime);
        return (round, int256(value), price.publishTime, price.publishTime, round);
    }

    function getRoundData(uint80 requested) external view returns (uint80, int256, uint256, uint256, uint80) {
        (uint80 round, int256 answer, uint256 started, uint256 updated, uint80 answered) = latestRoundData();
        if (requested != round) revert InvalidPrice();
        return (round, answer, started, updated, answered);
    }
}
