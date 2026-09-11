// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHouseRegistryVault {
    function asset() external view returns (address);
    function manager() external view returns (address);
}

contract HouseRegistry {
    struct House {
        address vault;
        address asset;
        address manager;
        bool active;
    }

    mapping(address => House) public houses;
    address public immutable governance;
    error Unauthorized();
    error Invalid();
    event HouseRegistered(address indexed house, address vault);
    event HouseDisabled(address indexed house);

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
    }

    function register(address house, address vault, address asset, address manager) external {
        if (msg.sender != governance || house == address(0) || vault.code.length == 0 || asset.code.length == 0 || manager == address(0)) revert Invalid();
        if (IHouseRegistryVault(vault).asset() != asset || IHouseRegistryVault(vault).manager() != manager) revert Invalid();
        houses[house] = House(vault, asset, manager, true);
        emit HouseRegistered(house, vault);
    }

    function disable(address house) external {
        if (msg.sender != governance) revert Unauthorized();
        houses[house].active = false;
        emit HouseDisabled(house);
    }
}
