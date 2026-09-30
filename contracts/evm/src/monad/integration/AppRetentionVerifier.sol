// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppRetentionVerifier, IAppRetentionReader} from "./IAppRetentionVerifier.sol";
import {IAppStateReader} from "./IAppStateReader.sol";
import {IAppCashReader} from "./IAppCashReader.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";

interface IRetentionCore {
    function creditAccount(bytes32 creditId) external view returns (address);
    function creditBorrower(bytes32 creditId) external view returns (address);
    function creditVault(bytes32 creditId) external view returns (address);
    function creditDebt(bytes32 creditId) external view returns (uint256);
    function healthMaxAge() external view returns (uint256);
}
interface IRetentionVault { function asset() external view returns (address); }

contract AppRetentionVerifier is IAppRetentionVerifier {
    address public immutable core;
    address public immutable reader;
    bytes32 public immutable readerCodeHash;
    address public immutable ownershipReader;
    bytes32 public immutable ownershipReaderCodeHash;
    error Invalid();

    constructor(address core_, address reader_, address ownershipReader_) {
        if (core_.code.length == 0 || reader_.code.length == 0 || ownershipReader_.code.length == 0
            || CodeInspection.delegates(reader_) || CodeInspection.delegates(ownershipReader_)) revert Invalid();
        if (!IAppStateReader(reader_).supportsInterface(type(IAppStateReader).interfaceId)
            || !IAppStateReader(reader_).supportsInterface(type(IAppCashReader).interfaceId)) revert Invalid();
        core = core_; reader = reader_; ownershipReader = ownershipReader_;
        readerCodeHash = reader_.codehash; ownershipReaderCodeHash = ownershipReader_.codehash;
    }

    function canRetain(bytes32 creditId, address account, address borrower) external view returns (bool) {
        IRetentionCore c = IRetentionCore(core);
        if (account == address(0) || borrower == address(0) || reader.codehash != readerCodeHash
            || ownershipReader.codehash != ownershipReaderCodeHash || c.creditAccount(creditId) != account
            || c.creditBorrower(creditId) != borrower || c.creditDebt(creditId) != 0
            || IAppStateReader(reader).pendingCount(creditId, account) != 0) return false;
        address asset = IRetentionVault(c.creditVault(creditId)).asset();
        (uint256 reserved, uint256 cashTime) = IAppCashReader(reader).reservedCash(creditId, account, asset);
        (bool owned, bool authorityGone, bool isolated, uint256 ownershipTime) =
            IAppRetentionReader(ownershipReader).retentionState(creditId, account, borrower);
        uint256 maxAge = c.healthMaxAge();
        return reserved == 0 && owned && authorityGone && isolated
            && _fresh(cashTime, maxAge) && _fresh(ownershipTime, maxAge);
    }

    function _fresh(uint256 observedAt, uint256 maxAge) private view returns (bool) {
        return observedAt != 0 && observedAt <= block.timestamp && block.timestamp - observedAt <= maxAge;
    }
}
