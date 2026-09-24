// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AppHealthReader} from "../src/monad/risk/AppHealthReader.sol";

contract DeployAppHealthReader is Script {
    function run() external returns (AppHealthReader reader) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        bytes32 bundleId = vm.envBytes32("APP_BUNDLE_ID");
        address collateralReader = vm.envAddress("COLLATERAL_READER_ADDRESS");
        address appReader = vm.envAddress("APP_READER_ADDRESS");
        address recoveryAdapter = vm.envAddress("APP_RECOVERY_ADAPTER_ADDRESS");
        require(block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        vm.startBroadcast(key);
        reader = new AppHealthReader(core, bundleId, collateralReader, appReader, recoveryAdapter);
        vm.stopBroadcast();
    }
}
