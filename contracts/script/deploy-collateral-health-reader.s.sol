// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {CollateralHealthReader} from "../src/risk/CollateralHealthReader.sol";

contract DeployCollateralHealthReader is Script {
    function run() external returns (CollateralHealthReader reader) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        address governance = vm.envAddress("GOVERNANCE_ADDRESS");
        address oracleRegistry = vm.envAddress("ORACLE_REGISTRY_ADDRESS");
        vm.startBroadcast(key);
        reader = new CollateralHealthReader(core, governance, oracleRegistry);
        vm.stopBroadcast();
    }
}
