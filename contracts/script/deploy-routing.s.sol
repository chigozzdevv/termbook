// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {RouteRegistry} from "../src/routing/RouteRegistry.sol";
import {InboxFactory} from "../src/routing/InboxFactory.sol";

contract DeployRouting is Script {
    function run() external returns (RouteRegistry routes, InboxFactory inboxes) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address governance = vm.envOr("GOVERNANCE", vm.addr(key));
        vm.startBroadcast(key);
        routes = new RouteRegistry(governance);
        inboxes = new InboxFactory(governance);
        vm.stopBroadcast();
    }
}
