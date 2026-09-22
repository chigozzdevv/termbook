// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../shared/Types.sol";
import {HealthMath} from "./HealthMath.sol";
import {IHealthReader, IHealthSource, HealthReading} from "./IHealthSource.sol";

contract HealthSource is IHealthSource {
    struct Reader {
        address impl;
        uint256 version;
        bool active;
        uint256 maxAge;
        bytes32 codeHash;
    }

    address public immutable governance;
    address public immutable oracleRegistry;
    mapping(bytes32 => Reader) public readers;

    event ReaderSet(bytes32 indexed bundleId, address indexed reader, uint256 version, uint256 maxAge);
    event ReaderDisabled(bytes32 indexed bundleId);

    error Unauthorized();
    error Invalid();
    error Stale();
    error BadReading();

    constructor(address governance_, address oracleRegistry_) {
        if (governance_ == address(0) || oracleRegistry_ == address(0) || oracleRegistry_.code.length == 0) {
            revert Invalid();
        }
        governance = governance_;
        oracleRegistry = oracleRegistry_;
    }

    function setReader(bytes32 bundleId, address reader, uint256 version, uint256 maxAge) external {
        if (
            msg.sender != governance || bundleId == bytes32(0) || reader.code.length == 0 || version == 0
                || maxAge == 0
        ) revert Invalid();
        if (readers[bundleId].impl != address(0)) revert Invalid();
        readers[bundleId] = Reader(reader, version, true, maxAge, reader.codehash);
        emit ReaderSet(bundleId, reader, version, maxAge);
    }

    function disable(bytes32 bundleId) external {
        if (msg.sender != governance) revert Unauthorized();
        readers[bundleId].active = false;
        emit ReaderDisabled(bundleId);
    }

    function snapshot(bytes32 creditId, bytes32 bundleId, uint256 revision, uint256 debt)
        external
        view
        returns (Types.HealthSnapshot memory result)
    {
        Reader memory config = readers[bundleId];
        if (
            !config.active || config.impl.code.length == 0 || config.impl.codehash != config.codeHash
                || block.timestamp < 1
        ) revert Invalid();
        HealthReading memory reading = IHealthReader(config.impl).readHealth(creditId, revision, debt, oracleRegistry);
        if (
            reading.debt != debt || reading.observedAt == 0 || reading.observedAt > block.timestamp
                || block.timestamp - reading.observedAt > config.maxAge
                || reading.retainedSource > 10_000 || reading.retainedApp > 10_000
        ) revert Stale();
        uint256 recovery = HealthMath.recoveryValue(
            reading.cash,
            reading.sourceValue,
            reading.retainedSource,
            reading.appValue,
            reading.retainedApp,
            reading.recoveryCosts
        );
        result = Types.HealthSnapshot(
            reading.debt,
            reading.cash,
            reading.sourceValue,
            reading.appValue,
            reading.retainedSource,
            reading.retainedApp,
            reading.recoveryCosts,
            recovery,
            HealthMath.healthBps(recovery, reading.debt, reading.recoveryCosts)
        );
    }
}
