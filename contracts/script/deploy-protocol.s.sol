// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {TermbookCore} from "../src/credit/TermbookCore.sol";
import {RiskEngine} from "../src/risk/RiskEngine.sol";
import {AccountFactory} from "../src/credit/AccountFactory.sol";
import {IntegrationRegistry} from "../src/integration/IntegrationRegistry.sol";
import {HouseVault} from "../src/house/HouseVault.sol";
import {ProtocolGovernance} from "../src/governance/ProtocolGovernance.sol";
import {Guardian} from "../src/governance/Guardian.sol";
import {HouseRegistry} from "../src/house/HouseRegistry.sol";
import {VerifierRegistry} from "../src/collateral/VerifierRegistry.sol";

contract DeployProtocol is Script {
    function run()
        external
        returns (
            TermbookCore core,
            RiskEngine risk,
            AccountFactory accounts,
            IntegrationRegistry integrations,
            address houseVault,
            ProtocolGovernance protocolGovernance,
            Guardian guardianController,
            HouseRegistry houseRegistry,
            VerifierRegistry verifierRegistry
        )
    {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        address governance = vm.envOr("GOVERNANCE", deployer);
        address guardian = vm.envOr("GUARDIAN", deployer);
        address manager = vm.envOr("HOUSE_MANAGER", deployer);
        vm.startBroadcast(key);
        protocolGovernance = new ProtocolGovernance(governance);
        guardianController = new Guardian(guardian, governance);
        houseRegistry = new HouseRegistry(address(protocolGovernance));
        verifierRegistry = new VerifierRegistry(address(protocolGovernance));
        core = new TermbookCore(deployer, address(guardianController), address(0));
        risk = new RiskEngine(address(core));
        accounts = new AccountFactory();
        integrations = new IntegrationRegistry(address(protocolGovernance));
        core.setRisk(address(risk));
        core.setIntegrationRegistry(address(integrations));
        core.setHouseRegistry(address(houseRegistry));
        core.setVerifierRegistry(address(verifierRegistry));
        core.setGovernance(address(protocolGovernance));
        address asset = vm.envOr("SETTLEMENT_ASSET", address(0));
        if (asset != address(0)) {
            houseVault = address(new HouseVault(asset, address(core), manager));
            HouseVault(houseVault).setPauseGuardian(address(guardianController));
        }
        vm.stopBroadcast();
    }
}
