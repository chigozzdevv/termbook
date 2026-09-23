// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockRemoteSaleOracle {
    uint256 public price = 5e18;
    bool public stale;

    function setPrice(uint256 value) external {
        price = value;
    }

    function setStale(bool value) external {
        stale = value;
    }

    function read(bytes32) external view returns (uint256, uint256, uint80) {
        if (stale) revert("stale-price");
        return (price, block.timestamp, 1);
    }
}
