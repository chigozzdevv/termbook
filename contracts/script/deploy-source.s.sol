// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {CollateralVault} from "../src/collateral/CollateralVault.sol";
import {VaultFactory} from "../src/collateral/VaultFactory.sol";
import {MonadVerifier} from "../src/collateral/MonadVerifier.sol";
import {EthereumVerifier} from "../src/collateral/EthereumVerifier.sol";

contract DeploySource is Script {
    function run() external returns (VaultFactory factory, address verifier, address vault) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("CORE_ADDRESS");
        address asset = vm.envAddress("COLLATERAL_ASSET");
        uint256 sourceChain = vm.envUint("SOURCE_CHAIN_ID");
        address lightClient = vm.envAddress("LIGHT_CLIENT_ADDRESS");
        vm.startBroadcast(key);
        factory = new VaultFactory();
        verifier = sourceChain == block.chainid ? address(new MonadVerifier(lightClient)) : address(new EthereumVerifier(lightClient));
        vault = address(new CollateralVault(asset, sourceChain, core));
        vm.stopBroadcast();
    }
}
