// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TermbookCore} from "../credit/TermbookCore.sol";
import {IAppValueReader} from "../integration/IAppValueReader.sol";
import {IHealthReader, HealthReading} from "./IHealthSource.sol";

interface IAppHealthVault {
    function asset() external view returns (address);
}

contract AppHealthReader is IHealthReader {
    TermbookCore public immutable core;
    bytes32 public immutable bundleId;
    IHealthReader public immutable collateralReader;
    IAppValueReader public immutable appReader;
    address public immutable recoveryAdapter;
    bytes32 public immutable collateralReaderCodeHash;
    bytes32 public immutable appReaderCodeHash;
    bytes32 public immutable recoveryAdapterCodeHash;

    error Invalid();

    constructor(address core_, bytes32 bundleId_, address collateralReader_, address appReader_, address recoveryAdapter_) {
        if (core_.code.length == 0 || bundleId_ == bytes32(0) || collateralReader_.code.length == 0
            || appReader_.code.length == 0 || recoveryAdapter_.code.length == 0
            || TermbookCore(core_).appRecoveryAdapterOfBundle(bundleId_) != recoveryAdapter_) revert Invalid();
        core = TermbookCore(core_);
        bundleId = bundleId_;
        collateralReader = IHealthReader(collateralReader_);
        appReader = IAppValueReader(appReader_);
        recoveryAdapter = recoveryAdapter_;
        collateralReaderCodeHash = collateralReader_.codehash;
        appReaderCodeHash = appReader_.codehash;
        recoveryAdapterCodeHash = recoveryAdapter_.codehash;
    }

    function readHealth(bytes32 creditId, uint256 revision, uint256 debt, address oracleRegistry)
        external
        view
        returns (HealthReading memory reading)
    {
        if (address(collateralReader).codehash != collateralReaderCodeHash
            || address(appReader).codehash != appReaderCodeHash
            || recoveryAdapter.codehash != recoveryAdapterCodeHash
            || core.appRecoveryAdapterOfBundle(bundleId) != recoveryAdapter) revert Invalid();
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        if (credit.bundleId != bundleId || credit.account == address(0) || credit.vault == address(0)) revert Invalid();
        reading = collateralReader.readHealth(creditId, revision, debt, oracleRegistry);
        if (reading.appValue != 0 || reading.retainedApp != 0) revert Invalid();
        (int256 value, uint16 retained, uint128 costs, uint256 observedAt) =
            appReader.readAppValue(creditId, credit.account, IAppHealthVault(credit.vault).asset());
        if (retained > 10_000 || observedAt == 0 || observedAt > block.timestamp) revert Invalid();
        reading.appValue = value;
        reading.retainedApp = retained;
        reading.recoveryCosts += costs;
        if (observedAt < reading.observedAt) reading.observedAt = observedAt;
    }
}
