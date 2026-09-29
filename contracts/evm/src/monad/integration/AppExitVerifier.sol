// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppStateReader} from "./IAppStateReader.sol";
import {IExitVerifier} from "./IExitVerifier.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";
import {IAppCashReader} from "./IAppCashReader.sol";

interface IAppExitCore {
    function creditAccount(bytes32 creditId) external view returns (address);
    function creditVault(bytes32 creditId) external view returns (address);
    function healthMaxAge() external view returns (uint256);
}

interface IAppExitVault { function asset() external view returns (address); }

contract AppExitVerifier is IExitVerifier {
    address public immutable core;
    IAppStateReader public immutable reader;
    bytes32 public immutable readerCodeHash;

    error Invalid();

    constructor(address core_, address reader_) {
        if (core_.code.length == 0 || reader_.code.length == 0 || CodeInspection.delegates(reader_)) revert Invalid();
        try IAppStateReader(reader_).supportsInterface(type(IAppStateReader).interfaceId) returns (bool supported) {
            if (!supported) revert Invalid();
        } catch {
            revert Invalid();
        }
        if (!IAppStateReader(reader_).supportsInterface(type(IAppCashReader).interfaceId)) revert Invalid();
        core = core_;
        reader = IAppStateReader(reader_);
        readerCodeHash = reader_.codehash;
    }

    function canExit(bytes32 creditId, address account) external view returns (bool) {
        if (account == address(0) || address(reader).codehash != readerCodeHash
            || IAppExitCore(core).creditAccount(creditId) != account
            || reader.positionCount(creditId, account) != 0 || reader.pendingCount(creditId, account) != 0) return false;
        address token = IAppExitVault(IAppExitCore(core).creditVault(creditId)).asset();
        (uint256 reserved, uint256 observedAt) = IAppCashReader(address(reader)).reservedCash(creditId, account, token);
        return reserved == 0 && observedAt != 0 && observedAt <= block.timestamp
            && block.timestamp - observedAt <= IAppExitCore(core).healthMaxAge();
    }
}
