// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WormholeNetworks} from "../src/shared/collateral/WormholeNetworks.sol";
import {Script} from "forge-std/Script.sol";
import {WormholeEvmMessageClient} from "../src/shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeEthereumVerifier} from "../src/monad/collateral/WormholeEthereumVerifier.sol";

contract DeployEthereumWormholeVerifier is Script {
    function run() external returns (WormholeEvmMessageClient client, WormholeEthereumVerifier verifier) {
        require((block.chainid == 143 || block.chainid == 10143) && vm.envUint("MONAD_CHAIN_ID") == block.chainid, "invalid-chain");
        address wormhole = vm.envAddress("MONAD_WORMHOLE_CORE");
        address publisher = vm.envAddress("SOURCE_PUBLISHER_ADDRESS");
        bytes32 publisherHash = vm.envBytes32("SOURCE_PUBLISHER_CODE_HASH");
        address vault = vm.envAddress("SOURCE_VAULT_ADDRESS");
        bytes32 vaultHash = vm.envBytes32("SOURCE_VAULT_CODE_HASH");
        address controller = vm.envAddress("SOURCE_CONTROLLER_ADDRESS");
        bytes32 controllerHash = vm.envBytes32("SOURCE_CONTROLLER_CODE_HASH");
        uint256 version = vm.envUint("ETHEREUM_WORMHOLE_VERIFIER_VERSION");
        uint256 maxAge = vm.envUint("ETHEREUM_WORMHOLE_PROOF_MAX_AGE");
        uint256 sourceChain = vm.envOr("SOURCE_CHAIN_ID", WormholeNetworks.ethereumChain(block.chainid));
        require(WormholeNetworks.isEvmSource(sourceChain, block.chainid), "invalid-source-chain");
        require(maxAge >= 2 hours, "proof-age-too-short");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        client = new WormholeEvmMessageClient(wormhole, WormholeNetworks.monadWormholeChain(block.chainid), WormholeNetworks.evmWormholeChain(sourceChain), sourceChain, version, bytes32(uint256(uint160(publisher))), maxAge);
        verifier = new WormholeEthereumVerifier(
            address(client), publisher, publisherHash, vault, vaultHash, controller, controllerHash
        );
        vm.stopBroadcast();
    }
}
