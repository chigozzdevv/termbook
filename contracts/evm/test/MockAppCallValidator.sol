// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppCallValidator} from "../src/monad/integration/IAppCallValidator.sol";

contract MockAppCallValidator is IAppCallValidator {
    function validateAction(bytes32, address, bytes calldata, address, uint256) external pure returns (bool) {
        return true;
    }

    function validateRecovery(bytes32, address, bytes calldata, address) external pure returns (bool) {
        return true;
    }
}
