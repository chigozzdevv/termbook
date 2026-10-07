// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

abstract contract ProxyInitializable is Initializable {
    constructor() { _disableInitializers(); }

    function upgradeContractId() external pure virtual returns (bytes32);
}
