// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../../shared/Types.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";
import {IHealthSource} from "./IHealthSource.sol";
import {HealthSource} from "./HealthSource.sol";
import {AccountFactory} from "../credit/AccountFactory.sol";
import {CreditAccount} from "../credit/CreditAccount.sol";

interface IAccountHealthCore {
    function creditAccount(bytes32) external view returns (address);
    function creditBorrower(bytes32) external view returns (address);
}

contract AccountHealthSource is IHealthSource {
    address public immutable core;
    HealthSource public immutable source;
    AccountFactory public immutable accountFactory;
    bytes32 public immutable sourceCodeHash;
    bytes32 public immutable factoryCodeHash;
    error InvalidAccount();

    constructor(address core_, address source_, address factory_) {
        if (core_.code.length == 0 || source_.code.length == 0 || factory_.code.length == 0
            || CodeInspection.delegates(source_) || CodeInspection.delegates(factory_)) revert InvalidAccount();
        core = core_;
        source = HealthSource(source_);
        accountFactory = AccountFactory(factory_);
        sourceCodeHash = source_.codehash;
        factoryCodeHash = factory_.codehash;
    }

    function accountValid(bytes32 creditId) public view returns (bool) {
        if (address(source).codehash != sourceCodeHash || address(accountFactory).codehash != factoryCodeHash) return false;
        address account = IAccountHealthCore(core).creditAccount(creditId);
        if (account.code.length == 0 || accountFactory.accountOf(creditId) != account) return false;
        CreditAccount creditAccount = CreditAccount(payable(account));
        return creditAccount.creditId() == creditId && creditAccount.core() == core
            && creditAccount.borrower() == IAccountHealthCore(core).creditBorrower(creditId);
    }

    function snapshot(bytes32 creditId, bytes32 bundleId, uint256 revision, uint256 debt)
        external view returns (Types.HealthSnapshot memory) {
        if (!accountValid(creditId)) revert InvalidAccount();
        return source.snapshot(creditId, bundleId, revision, debt);
    }

    function freeCash(bytes32 creditId, bytes32 bundleId, uint256 revision) external view returns (uint256) {
        if (!accountValid(creditId)) revert InvalidAccount();
        return source.freeCash(creditId, bundleId, revision);
    }

    function oracleRegistry() external view returns (address) { return source.oracleRegistry(); }
    function isReaderActive(bytes32 bundleId) external view returns (bool) { return source.isReaderActive(bundleId); }
    function readers(bytes32 bundleId) external view returns (address, uint256, bool, uint256, bytes32) {
        return source.readers(bundleId);
    }
}
