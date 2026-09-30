// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AppRetentionVerifier} from "../src/monad/integration/AppRetentionVerifier.sol";

contract DeployRetentionVerifier is Script {
    function run() external returns (AppRetentionVerifier verifier) {
        require(block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        address reader = vm.envAddress("APP_READER_ADDRESS");
        address ownership = vm.envAddress("APP_RETENTION_READER_ADDRESS");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        verifier = new AppRetentionVerifier(core, reader, ownership);
        vm.stopBroadcast();
    }
}
