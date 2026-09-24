// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {AppExitVerifier} from "../src/monad/integration/AppExitVerifier.sol";

contract DeployAppExitVerifier is Script {
    function run() external returns (AppExitVerifier verifier) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        address appReader = vm.envAddress("APP_READER_ADDRESS");
        require(block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        vm.startBroadcast(key);
        verifier = new AppExitVerifier(core, appReader);
        vm.stopBroadcast();
    }
}
