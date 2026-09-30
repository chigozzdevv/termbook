// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {TermbookCore} from "../src/monad/credit/TermbookCore.sol";
import {FlowExecutor} from "../src/monad/integration/FlowExecutor.sol";
import {ReservationManager} from "../src/monad/house/ReservationManager.sol";
import {PriceProtection} from "../src/monad/integration/PriceProtection.sol";
import {RiskEngine} from "../src/monad/risk/RiskEngine.sol";
import {AccountFactory} from "../src/monad/credit/AccountFactory.sol";
import {IntegrationRegistry} from "../src/monad/integration/IntegrationRegistry.sol";
import {HouseVault} from "../src/monad/house/HouseVault.sol";
import {ProtocolGovernance} from "../src/monad/governance/ProtocolGovernance.sol";
import {Guardian} from "../src/monad/governance/Guardian.sol";
import {HouseRegistry} from "../src/monad/house/HouseRegistry.sol";
import {VerifierRegistry} from "../src/monad/collateral/VerifierRegistry.sol";
import {OracleRegistry} from "../src/monad/risk/OracleRegistry.sol";
import {HealthSource} from "../src/monad/risk/HealthSource.sol";
import {InboxFactory} from "../src/monad/routing/InboxFactory.sol";

contract DeployProtocol is Script {
    function run()
        external
        returns (
            TermbookCore core,
            RiskEngine risk,
            AccountFactory accounts,
            IntegrationRegistry integrations,
            InboxFactory inboxFactory,
            address houseVault,
            ProtocolGovernance protocolGovernance,
            Guardian guardianController,
            HouseRegistry houseRegistry,
            VerifierRegistry verifierRegistry,
            OracleRegistry oracleRegistry,
            HealthSource healthSource
        )
    {
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(block.chainid == vm.envUint("MONAD_CHAIN_ID"), "invalid-chain");
        address deployer = vm.addr(key);
        address governance = vm.envAddress("GOVERNANCE");
        address guardian = vm.envAddress("GUARDIAN");
        address manager = vm.envAddress("HOUSE_MANAGER");
        address asset = vm.envAddress("SETTLEMENT_ASSET");
        require(asset.code.length != 0, "settlement-asset-missing");
        vm.startBroadcast(key);
        protocolGovernance = new ProtocolGovernance(governance);
        guardianController = new Guardian(guardian, governance);
        houseRegistry = new HouseRegistry(address(protocolGovernance));
        verifierRegistry = new VerifierRegistry(address(protocolGovernance));
        address predictedCore = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 3);
        address execution = address(new FlowExecutor(predictedCore));
        address reservations = address(new ReservationManager(predictedCore));
        address prices = address(new PriceProtection(predictedCore));
        core = new TermbookCore(deployer, address(guardianController), address(0), execution, reservations, prices);
        require(address(core) == predictedCore, "core-address-mismatch");
        risk = new RiskEngine(address(core));
        accounts = new AccountFactory();
        integrations = new IntegrationRegistry(address(protocolGovernance));
        inboxFactory = new InboxFactory(address(protocolGovernance));
        oracleRegistry = new OracleRegistry(address(protocolGovernance));
        healthSource = new HealthSource(address(protocolGovernance), address(oracleRegistry));
        core.setRisk(address(risk));
        core.setIntegrationRegistry(address(integrations));
        core.setHouseRegistry(address(houseRegistry));
        core.setVerifierRegistry(address(verifierRegistry));
        core.setHealthSource(address(healthSource));
        core.setGovernance(address(protocolGovernance));
        houseVault =
            address(new HouseVault(asset, address(core), manager, address(inboxFactory), address(guardianController)));
        vm.stopBroadcast();
    }
}
