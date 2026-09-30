// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WormholeNetworks} from "../src/shared/collateral/WormholeNetworks.sol";
import {Script} from "forge-std/Script.sol";
import {WormholeEvmMessageClient} from "../src/shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeMonadVerifier} from "../src/ethereum/collateral/WormholeMonadVerifier.sol";
import {RemoteCollateralController} from "../src/ethereum/collateral/RemoteCollateralController.sol";
import {SourceRecoveryVault} from "../src/ethereum/collateral/SourceRecoveryVault.sol";
import {WormholeEthereumPublisher} from "../src/ethereum/collateral/WormholeEthereumPublisher.sol";

contract DeploySourceWormhole is Script {
    function run()
        external
        returns (
            RemoteCollateralController controller,
            SourceRecoveryVault recovery,
            WormholeMonadVerifier verifier,
            WormholeEthereumPublisher publisher
        )
    {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        address factory = vm.envAddress("MONAD_FACTORY_ADDRESS");
        address asset = vm.envAddress("COLLATERAL_ASSET");
        address wormhole = vm.envAddress("ETHEREUM_WORMHOLE_CORE");
        address governance = vm.envAddress("SOURCE_GOVERNANCE");
        address pauseGuardian = vm.envAddress("SOURCE_PAUSE_GUARDIAN");
        address routeSigner = vm.envAddress("ROUTE_SIGNER");
        address riskSigner = vm.envAddress("RECOVERY_RISK_SIGNER");
        uint256 version = vm.envUint("MONAD_WORMHOLE_VERIFIER_VERSION");
        uint256 maxAge = vm.envUint("MONAD_WORMHOLE_PROOF_MAX_AGE");
        require(maxAge >= 2 hours, "proof-age-too-short");
        require((block.chainid == 1 || block.chainid == 11155111) && vm.envUint("SOURCE_CHAIN_ID") == block.chainid, "invalid-source-chain");
        uint256 monadChain = WormholeNetworks.monadChain(block.chainid);
        uint16 monadWormholeChain = WormholeNetworks.monadWormholeChain(block.chainid);
        uint16 ethereumWormholeChain = WormholeNetworks.ethereumWormholeChain(block.chainid);
        require(vm.envUint("MONAD_CHAIN_ID") == monadChain, "invalid-monad-chain");
        vm.startBroadcast(key);
        WormholeEvmMessageClient coreClient =
            new WormholeEvmMessageClient(wormhole, ethereumWormholeChain, monadWormholeChain, monadChain, version, bytes32(uint256(uint160(core))), maxAge);
        WormholeEvmMessageClient factoryClient =
            new WormholeEvmMessageClient(wormhole, ethereumWormholeChain, monadWormholeChain, monadChain, version, bytes32(uint256(uint160(factory))), maxAge);
        verifier = new WormholeMonadVerifier(address(coreClient), address(factoryClient), core, factory);
        recovery = new SourceRecoveryVault(asset, monadChain, factory, address(verifier), governance, routeSigner, riskSigner);
        controller = new RemoteCollateralController(
            asset, monadChain, core, address(recovery), address(verifier), governance, pauseGuardian
        );
        publisher = new WormholeEthereumPublisher(address(controller.vault()), address(controller), wormhole);
        vm.stopBroadcast();
    }
}
