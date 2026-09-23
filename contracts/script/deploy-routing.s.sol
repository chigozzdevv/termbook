// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {RouteRegistry} from "../src/routing/RouteRegistry.sol";
import {InboxFactory} from "../src/routing/InboxFactory.sol";

contract DeployRouting is Script {
    function run() external returns (RouteRegistry routes) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address factory = vm.envAddress("MONAD_FACTORY_ADDRESS");
        require(factory.code.length != 0, "factory-missing");
        require(InboxFactory(factory).governance() == governance, "factory-governance-mismatch");
        require(InboxFactory(factory).routeRegistry() == address(0), "routes-already-set");
        vm.startBroadcast(key);
        routes = new RouteRegistry(governance);
        vm.stopBroadcast();
    }
}
