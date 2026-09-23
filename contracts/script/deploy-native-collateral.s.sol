// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {NativeCollateralVault} from "../src/collateral/NativeCollateralVault.sol";

contract DeployNativeCollateral is Script {
    function run() external returns (NativeCollateralVault vault) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address core = vm.envAddress("MONAD_CORE_ADDRESS");
        address wrappedMon = vm.envAddress("WRAPPED_MON_ADDRESS");
        uint256 chainId = vm.envUint("MONAD_CHAIN_ID");
        require(block.chainid == chainId, "invalid-chain");
        vm.startBroadcast(key);
        vault = new NativeCollateralVault(wrappedMon, chainId, core);
        vm.stopBroadcast();
    }
}
