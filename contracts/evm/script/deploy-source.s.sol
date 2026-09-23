// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {MonadVerifier} from "../src/ethereum/collateral/MonadVerifier.sol";
import {RemoteCollateralController} from "../src/ethereum/collateral/RemoteCollateralController.sol";
import {SourceRecoveryVault} from "../src/ethereum/collateral/SourceRecoveryVault.sol";

contract DeploySource is Script {
    function run()
        external
        returns (RemoteCollateralController controller, SourceRecoveryVault recovery, address verifier, address vault)
    {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        address factory = vm.envAddress("MONAD_FACTORY_ADDRESS");
        address asset = vm.envAddress("COLLATERAL_ASSET");
        uint256 monadChain = vm.envUint("MONAD_CHAIN_ID");
        address lightClient = vm.envAddress("LIGHT_CLIENT_ADDRESS");
        address routeSigner = vm.envAddress("ROUTE_SIGNER");
        address riskSigner = vm.envAddress("RECOVERY_RISK_SIGNER");
        address governance = vm.envAddress("SOURCE_GOVERNANCE");
        address pauseGuardian = vm.envAddress("SOURCE_PAUSE_GUARDIAN");
        require(block.chainid == 1 && block.chainid == vm.envUint("SOURCE_CHAIN_ID"), "invalid-source-chain");
        require(monadChain == 143, "invalid-monad-chain");
        vm.startBroadcast(key);
        verifier = address(new MonadVerifier(lightClient));
        recovery = new SourceRecoveryVault(asset, monadChain, factory, verifier, governance, routeSigner, riskSigner);
        controller = new RemoteCollateralController(
            asset, monadChain, core, address(recovery), verifier, governance, pauseGuardian
        );
        vault = address(controller.vault());
        // Governance calls recovery.setController(address(controller)) before source locks.
        vm.stopBroadcast();
    }
}
