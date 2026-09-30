// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WormholeNetworks} from "../src/shared/collateral/WormholeNetworks.sol";
import {Script} from "forge-std/Script.sol";
import {WormholeSolanaAccountClient} from "../src/monad/collateral/WormholeSolanaAccountClient.sol";
import {SolanaVerifier} from "../src/monad/collateral/SolanaVerifier.sol";

contract DeploySolanaWormhole is Script {
    function run() external returns (WormholeSolanaAccountClient client, SolanaVerifier verifier) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require((block.chainid == 143 || block.chainid == 10143) && block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        address wormhole = vm.envAddress("WORMHOLE_CORE_ADDRESS");
        uint256 sourceChain = vm.envUint("SOLANA_SOURCE_CHAIN");
        uint256 version = vm.envUint("SOLANA_VERIFIER_VERSION");
        bytes32 genesis = vm.envBytes32("SOLANA_GENESIS");
        bytes32 program = vm.envBytes32("SOLANA_PROGRAM_ID");
        bytes32 emitter = vm.envBytes32("SOLANA_EMITTER");
        bytes32 programDataHash = vm.envBytes32("SOLANA_PROGRAM_DATA_HASH");
        uint256 proofMaxAge = vm.envUint("SOLANA_PROOF_MAX_AGE");
        vm.startBroadcast(key);
        client = new WormholeSolanaAccountClient(
            wormhole, sourceChain, version, genesis, program, emitter, programDataHash, proofMaxAge
        );
        verifier = new SolanaVerifier(address(client), genesis, program, programDataHash);
        vm.stopBroadcast();
    }
}
