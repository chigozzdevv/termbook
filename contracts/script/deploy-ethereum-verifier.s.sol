// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {EthereumVerifier} from "../src/collateral/EthereumVerifier.sol";

contract DeployEthereumVerifier is Script {
    function run() external returns (EthereumVerifier verifier) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(block.chainid == 143 && block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        address client = vm.envAddress("ETHEREUM_LIGHT_CLIENT_ADDRESS");
        address vault = vm.envAddress("SOURCE_VAULT_ADDRESS");
        bytes32 vaultCodeHash = vm.envBytes32("SOURCE_VAULT_CODE_HASH");
        address controller = vm.envAddress("SOURCE_CONTROLLER_ADDRESS");
        bytes32 controllerCodeHash = vm.envBytes32("SOURCE_CONTROLLER_CODE_HASH");
        vm.startBroadcast(key);
        verifier = new EthereumVerifier(client, vault, vaultCodeHash, controller, controllerCodeHash);
        vm.stopBroadcast();
    }
}
