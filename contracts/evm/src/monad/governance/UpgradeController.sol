// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";
import {TestnetProxy} from "./TestnetProxy.sol";

contract UpgradeController is Ownable2Step {
    mapping(address => bytes32) public contractIds;
    error InvalidUpgrade();

    event ProxyRegistered(address indexed proxy, address indexed implementation, bytes32 contractId);
    event ImplementationApproved(address indexed proxy, address indexed implementation, bytes32 codeHash);

    constructor(address owner_) Ownable(owner_) {}

    function register(TestnetProxy proxy) external onlyOwner {
        if (address(proxy).code.length == 0 || contractIds[address(proxy)] != bytes32(0)
            || ProxyAdmin(proxy.proxyAdmin()).owner() != address(this)) revert InvalidUpgrade();
        address implementation = proxy.proxyImplementation();
        bytes32 id = ProxyInitializable(implementation).upgradeContractId();
        if (id == bytes32(0)) revert InvalidUpgrade();
        contractIds[address(proxy)] = id;
        emit ProxyRegistered(address(proxy), implementation, id);
    }

    function upgrade(TestnetProxy proxy, address implementation, bytes32 expectedCodeHash, bytes calldata data)
        external payable onlyOwner
    {
        bytes32 id = contractIds[address(proxy)];
        if (id == bytes32(0) || implementation.code.length == 0 || expectedCodeHash == bytes32(0)
            || implementation.codehash != expectedCodeHash || implementation == proxy.proxyImplementation()
            || ProxyInitializable(implementation).upgradeContractId() != id) revert InvalidUpgrade();
        ProxyAdmin(proxy.proxyAdmin()).upgradeAndCall{value: msg.value}(
            ITransparentUpgradeableProxy(payable(address(proxy))), implementation, data);
        emit ImplementationApproved(address(proxy), implementation, expectedCodeHash);
    }

    function renounceOwnership() public override onlyOwner { revert InvalidUpgrade(); }
}
