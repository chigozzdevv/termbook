// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

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

contract AccountHealthSource is IHealthSource, ProxyInitializable {
    address public core;
    HealthSource public source;
    AccountFactory public accountFactory;
    bytes32 public sourceCodeHash;
    bytes32 public factoryCodeHash;
    error InvalidAccount();

    constructor(address core_, address source_, address factory_) {
        if (!(
            core_ == address(0)
            && source_ == address(0)
            && factory_ == address(0)
        )) {
            _initializeAccountHealthSource(core_, source_, factory_);
        }
    }

    function initialize(address core_, address source_, address factory_) external initializer {
        _initializeAccountHealthSource(core_, source_, factory_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.AccountHealthSource.v1");
    }

    function _initializeAccountHealthSource(address core_, address source_, address factory_) private {
        if (core_.code.length == 0 || source_.code.length == 0 || factory_.code.length == 0
            || (CodeInspection.delegates(source_) && !CodeInspection.registeredTestnetProxy(source_))
            || (CodeInspection.delegates(factory_) && !CodeInspection.registeredTestnetProxy(factory_))) revert InvalidAccount();
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
