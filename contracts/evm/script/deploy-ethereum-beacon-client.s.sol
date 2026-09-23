// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {EthereumBeaconLightClient} from "../src/monad/collateral/EthereumBeaconLightClient.sol";
import {EthereumBeaconSsz} from "../src/monad/collateral/EthereumBeaconSsz.sol";

contract DeployEthereumBeaconClient is Script {
    function run() external returns (EthereumBeaconLightClient client) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(block.chainid == 143 && block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        string memory checkpoint = vm.readFile(vm.envString("ETHEREUM_CHECKPOINT_FILE"));
        EthereumBeaconSsz.BeaconHeader memory header = EthereumBeaconSsz.BeaconHeader({
            slot: uint64(vm.parseJsonUint(checkpoint, ".header.slot")),
            proposerIndex: uint64(vm.parseJsonUint(checkpoint, ".header.proposerIndex")),
            parentRoot: vm.parseJsonBytes32(checkpoint, ".header.parentRoot"),
            stateRoot: vm.parseJsonBytes32(checkpoint, ".header.stateRoot"),
            bodyRoot: vm.parseJsonBytes32(checkpoint, ".header.bodyRoot")
        });
        require(uint256(header.slot) == vm.parseJsonUint(checkpoint, ".header.slot"), "invalid-slot");
        require(uint256(header.proposerIndex) == vm.parseJsonUint(checkpoint, ".header.proposerIndex"), "invalid-proposer");
        bytes32 trustedRoot = vm.parseJsonBytes32(checkpoint, ".beaconRoot");
        bytes32 committeeRoot = vm.parseJsonBytes32(checkpoint, ".currentCommitteeRoot");
        bytes32[] memory branch = vm.parseJsonBytes32Array(checkpoint, ".currentCommitteeBranch");
        address governance = vm.envAddress("ETHEREUM_CHECKPOINT_GOVERNANCE");
        vm.startBroadcast(key);
        client = new EthereumBeaconLightClient(trustedRoot, header, committeeRoot, branch, governance);
        vm.stopBroadcast();
    }
}
