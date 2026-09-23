// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {MonadVerifier} from "../src/collateral/MonadVerifier.sol";
import {RemoteCollateralController} from "../src/collateral/RemoteCollateralController.sol";
import {SourceRecoveryVault} from "../src/collateral/SourceRecoveryVault.sol";

contract DeploySource is Script {
    function run() external returns (RemoteCollateralController controller, SourceRecoveryVault recovery, address verifier) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        address asset = vm.envAddress("COLLATERAL_ASSET");
        uint256 monadChain = vm.envUint("MONAD_CHAIN_ID");
        address lightClient = vm.envAddress("LIGHT_CLIENT_ADDRESS");
        address routeSigner = vm.envAddress("ROUTE_SIGNER");
        vm.startBroadcast(key);
        verifier = address(new MonadVerifier(lightClient));
        recovery = new SourceRecoveryVault(asset, monadChain, vm.addr(key), routeSigner);
        controller = new RemoteCollateralController(asset, monadChain, core, address(recovery), verifier);
        recovery.setController(address(controller));
        vm.stopBroadcast();
    }
}
