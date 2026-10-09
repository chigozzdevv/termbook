// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AppHealthReader} from "./AppHealthReader.sol";

contract AppHealthReaderFactory {
    address public immutable core;
    address public immutable collateralReader;
    error Invalid();
    constructor(address core_, address collateralReader_) {
        if (core_.code.length == 0 || collateralReader_.code.length == 0) revert Invalid();
        core = core_; collateralReader = collateralReader_;
    }
    function _salt(bytes32 bundle, address reader, address recovery) private pure returns (bytes32) {
        return keccak256(abi.encode(bundle, reader, recovery));
    }
    function predict(bytes32 bundle, address reader, address recovery) public view returns (address) {
        bytes32 codeHash = keccak256(abi.encodePacked(type(AppHealthReader).creationCode,
            abi.encode(core, bundle, collateralReader, reader, recovery)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(bundle, reader, recovery), codeHash)))));
    }
    function create(bytes32 bundle, address reader, address recovery) external returns (address result) {
        result = predict(bundle, reader, recovery);
        if (result.code.length == 0) {
            result = address(new AppHealthReader{salt: _salt(bundle, reader, recovery)}(core, bundle, collateralReader, reader, recovery));
        }
    }
}
