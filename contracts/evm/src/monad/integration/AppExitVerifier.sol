// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppStateReader} from "./IAppStateReader.sol";
import {IExitVerifier} from "./IExitVerifier.sol";

interface IAppExitCore {
    function creditAccount(bytes32 creditId) external view returns (address);
}

contract AppExitVerifier is IExitVerifier {
    address public immutable core;
    IAppStateReader public immutable reader;
    bytes32 public immutable readerCodeHash;

    error Invalid();

    constructor(address core_, address reader_) {
        if (core_.code.length == 0 || reader_.code.length == 0) revert Invalid();
        try IAppStateReader(reader_).supportsInterface(type(IAppStateReader).interfaceId) returns (bool supported) {
            if (!supported) revert Invalid();
        } catch {
            revert Invalid();
        }
        core = core_;
        reader = IAppStateReader(reader_);
        readerCodeHash = reader_.codehash;
    }

    function canExit(bytes32 creditId, address account) external view returns (bool) {
        return account != address(0) && address(reader).codehash == readerCodeHash
            && IAppExitCore(core).creditAccount(creditId) == account
            && reader.positionCount(creditId, account) == 0 && reader.pendingCount(creditId, account) == 0;
    }
}
