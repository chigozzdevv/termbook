// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

contract TestnetProxy is TransparentUpgradeableProxy, Initializable {
    error UnsupportedChain();
    error MissingInitialization();

    constructor(address implementation_, address controller_, bytes memory initialization)
        TransparentUpgradeableProxy(implementation_, controller_, initialization)
    {
        if (block.chainid != 10143 && block.chainid != 11155111 && block.chainid != 84532) revert UnsupportedChain();
        if (initialization.length < 4 || _getInitializedVersion() != 1) revert MissingInitialization();
    }

    function proxyImplementation() external view returns (address) { return ERC1967Utils.getImplementation(); }
    function proxyAdmin() external view returns (address) { return _proxyAdmin(); }
}
