// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CollateralVault} from "./CollateralVault.sol";

contract VaultFactory {
    address public immutable governance;
    mapping(bytes32 => address) public vaultOf;
    error Invalid();
    error Exists();
    event VaultCreated(address vault, address asset, uint256 chainId, address core);

    constructor() {
        governance = msg.sender;
    }

    function create(address, address asset, uint256 chainId, address core) external returns (address vault) {
        if (msg.sender != governance || asset.code.length == 0 || core == address(0)) revert Invalid();
        bytes32 key = keccak256(abi.encode(asset, chainId, core));
        if (vaultOf[key] != address(0)) revert Exists();
        vault = address(new CollateralVault(asset, chainId, core));
        vaultOf[key] = vault;
        emit VaultCreated(vault, asset, chainId, core);
    }
}
