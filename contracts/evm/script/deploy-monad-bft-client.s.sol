// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {MonadBftLightClient} from "../src/ethereum/collateral/MonadBftLightClient.sol";

contract DeployMonadBftClient is Script {
    function run() external returns (MonadBftLightClient client) {
        require(block.chainid == 1 && block.chainid == vm.envUint("SOURCE_CHAIN_ID"), "invalid-chain");
        uint256 sequence = vm.envUint("MONAD_BOOTSTRAP_SEQUENCE");
        uint256 epoch = vm.envUint("MONAD_BOOTSTRAP_EPOCH");
        require(sequence <= type(uint64).max && epoch <= type(uint64).max, "invalid-bootstrap");
        require(vm.envUint("MONAD_CHAIN_ID") == 143, "invalid-monad-chain");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        client = new MonadBftLightClient(
            143,
            vm.envUint("MONAD_CONSENSUS_VERSION"),
            vm.envUint("MONAD_PROOF_MAX_AGE"),
            vm.envBytes32("MONAD_BOOTSTRAP_HASH"),
            uint64(sequence),
            uint64(epoch),
            vm.envBytes32("MONAD_BOOTSTRAP_VALIDATOR_SET_HASH"),
            vm.envAddress("MONAD_EPOCH_COMMITTER")
        );
        vm.stopBroadcast();
    }
}
