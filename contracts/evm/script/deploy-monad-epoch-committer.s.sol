// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {MonadEpochCommitter} from "../src/monad/collateral/MonadEpochCommitter.sol";

contract DeployMonadEpochCommitter is Script {
    function run() external returns (MonadEpochCommitter committer) {
        require(block.chainid == 143 && block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        committer = new MonadEpochCommitter();
        vm.stopBroadcast();
    }
}
