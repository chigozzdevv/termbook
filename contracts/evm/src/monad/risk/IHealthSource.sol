// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../../shared/Types.sol";

struct HealthReading {
    uint256 debt;
    uint256 cash;
    uint256 sourceValue;
    int256 appValue;
    uint256 retainedSource;
    uint256 retainedApp;
    uint256 recoveryCosts;
    uint256 observedAt;
}

interface IHealthReader {
    function readHealth(bytes32 creditId, uint256 revision, uint256 debt, address oracleRegistry)
        external
        view
        returns (HealthReading memory);
}

interface IHealthSource {
    function snapshot(bytes32 creditId, bytes32 bundleId, uint256 revision, uint256 debt)
        external
        view
        returns (Types.HealthSnapshot memory);

    function freeCash(bytes32 creditId, bytes32 bundleId, uint256 revision) external view returns (uint256);
}

interface ICashReader {
    function readCash(bytes32 creditId, uint256 revision) external view returns (uint256 cash, uint256 observedAt);
}
