// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {TermbookCore} from "../src/credit/TermbookCore.sol";
import {RiskEngine} from "../src/risk/RiskEngine.sol";
import {AccountFactory} from "../src/credit/AccountFactory.sol";
import {IntegrationRegistry} from "../src/integration/IntegrationRegistry.sol";
import {HouseVault} from "../src/house/HouseVault.sol";

contract DeployProtocol is Script {
    function run() external returns (TermbookCore core, RiskEngine risk, AccountFactory accounts, IntegrationRegistry integrations, address houseVault) {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        address governance = vm.envOr("GOVERNANCE", deployer);
        address guardian = vm.envOr("GUARDIAN", deployer);
        address manager = vm.envOr("HOUSE_MANAGER", deployer);
        vm.startBroadcast(key);
        core = new TermbookCore(governance, guardian, address(0));
        risk = new RiskEngine(address(core));
        accounts = new AccountFactory();
        integrations = new IntegrationRegistry(governance);
        if (governance != deployer) revert("governance-must-deploy");
        core.setRisk(address(risk));
        core.setIntegrationRegistry(address(integrations));
        address asset = vm.envOr("SETTLEMENT_ASSET", address(0));
        if (asset != address(0)) houseVault = address(new HouseVault(asset, address(core), manager));
        vm.stopBroadcast();
    }
}
