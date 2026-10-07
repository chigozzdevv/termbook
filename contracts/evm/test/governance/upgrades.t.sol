// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TestnetProxy} from "../../src/monad/governance/TestnetProxy.sol";
import {UpgradeController} from "../../src/monad/governance/UpgradeController.sol";
import {ProtocolGovernance} from "../../src/monad/governance/ProtocolGovernance.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract RiskEngineV2 is RiskEngine {
    uint256 public upgradeMarker;
    constructor() RiskEngine(address(0)) {}
    function implementationVersion() external pure returns (uint256) { return 2; }
    function migrate(uint256 value) external reinitializer(2) { upgradeMarker = value; }
    function failingMigration() external pure { revert("migration-failed"); }
}
contract HouseVaultV2 is HouseVault {
    constructor() HouseVault(address(0), address(0), address(0), address(0), address(0)) {}
    function implementationVersion() external pure returns (uint256) { return 2; }
}

contract UpgradesTest is Test {
    UpgradeController controller;
    ProtocolGovernance governance;
    TestnetProxy proxy;
    RiskEngine risk;
    function setUp() public {
        vm.chainId(10143);
        governance = new ProtocolGovernance(address(this), 0);
        controller = new UpgradeController(address(this));
        RiskEngine implementation = new RiskEngine(address(0));
        proxy = new TestnetProxy(address(implementation), address(controller), abi.encodeCall(RiskEngine.initialize, (address(this))));
        controller.register(proxy);
        risk = RiskEngine(address(proxy));
    }
    function _governedUpgrade(address implementation, bytes memory data) private {
        bytes memory operation = abi.encodeCall(controller.upgrade, (proxy, implementation, implementation.codehash, data));
        governance.queue(address(controller), 0, operation, bytes32("upgrade"));
        governance.execute(address(controller), 0, operation, bytes32("upgrade"));
    }
    function _handover() private {
        controller.transferOwnership(address(governance));
        bytes memory operation = abi.encodeCall(controller.acceptOwnership, ());
        governance.queue(address(controller), 0, operation, bytes32("handover"));
        governance.execute(address(controller), 0, operation, bytes32("handover"));
    }
    function testUpgradePreservesRiskBandsAndEnforcesGovernance() public {
        assertEq(risk.protocolFloorBps(), 11_000);
        bytes32 credit = keccak256("credit");
        risk.setRiskBands(credit, 15_000, 13_000, 12_000, 11_500, 11_000);
        _handover();
        RiskEngineV2 next = new RiskEngineV2();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        controller.upgrade(proxy, address(next), address(next).codehash, "");
        _governedUpgrade(address(next), abi.encodeCall(next.migrate, (77)));
        assertEq(proxy.proxyImplementation(), address(next));
        assertEq(RiskEngineV2(address(proxy)).implementationVersion(), 2);
        assertEq(RiskEngineV2(address(proxy)).upgradeMarker(), 77);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        RiskEngineV2(address(proxy)).migrate(88);
        assertEq(risk.core(), address(this));
        assertEq(risk.initialBps(credit), 15_000);
        assertEq(risk.liquidationBps(credit), 11_000);
        assertEq(risk.protocolFloorBps(), 11_000);
        vm.prank(address(9)); vm.expectRevert(RiskEngine.Unauthorized.selector);
        risk.setThresholds(credit, 16_000, 14_000, 12_000);
    }
    function testInitializersCannotBeReplayedOrCalledOnImplementation() public {
        address implementation = proxy.proxyImplementation();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        risk.initialize(address(8));
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        RiskEngine(implementation).initialize(address(8));
    }
    function testProxyRejectsCallsThatDoNotInitializeStorage() public {
        address implementation = proxy.proxyImplementation();
        vm.expectRevert(TestnetProxy.MissingInitialization.selector);
        new TestnetProxy(implementation, address(controller), abi.encodeCall(risk.core, ()));
    }
    function testRejectsWrongContractTypeAndChangedReviewedCodeHash() public {
        HouseVaultV2 wrong = new HouseVaultV2();
        vm.expectRevert(UpgradeController.InvalidUpgrade.selector);
        controller.upgrade(proxy, address(wrong), address(wrong).codehash, "");
        RiskEngineV2 next = new RiskEngineV2();
        vm.expectRevert(UpgradeController.InvalidUpgrade.selector);
        controller.upgrade(proxy, address(next), keccak256("wrong"), "");
    }
    function testMigrationRevertRollsBackImplementationAndPreservesState() public {
        address previous = proxy.proxyImplementation();
        RiskEngineV2 next = new RiskEngineV2();
        vm.expectRevert("migration-failed");
        controller.upgrade(proxy, address(next), address(next).codehash, abi.encodeCall(next.failingMigration, ()));
        assertEq(proxy.proxyImplementation(), previous);
        assertEq(risk.protocolFloorBps(), 11_000);
    }
    function testTwoStepOwnershipCanTransferToMultisigAndCancel() public {
        address multisig = address(0x515);
        controller.transferOwnership(multisig);
        assertEq(controller.owner(), address(this));
        vm.prank(address(8)); vm.expectRevert(); controller.acceptOwnership();
        vm.prank(multisig); controller.acceptOwnership();
        assertEq(controller.owner(), multisig);
        vm.expectRevert(); controller.transferOwnership(address(this));
        governance.transferGovernance(multisig);
        assertEq(governance.governance(), address(this));
        vm.prank(address(8)); vm.expectRevert(); governance.acceptGovernance();
        governance.transferGovernance(address(0));
        vm.prank(multisig); vm.expectRevert(); governance.acceptGovernance();
        governance.transferGovernance(multisig);
        vm.prank(multisig); governance.acceptGovernance();
        assertEq(governance.governance(), multisig);
        vm.expectRevert(); governance.queue(address(controller), 0, "", bytes32("unauthorized"));
    }
    function testMutableProxyModeIsRejectedOnMainnet() public {
        vm.chainId(143);
        RiskEngine implementation = new RiskEngine(address(0));
        vm.expectRevert(TestnetProxy.UnsupportedChain.selector);
        new TestnetProxy(address(implementation), address(controller), abi.encodeCall(RiskEngine.initialize, (address(this))));
    }
    function testHouseUpgradePreservesLiquiditySharesAndRecoveryReserve() public {
        MockERC20 token = new MockERC20();
        HouseVault implementation = new HouseVault(address(0), address(0), address(0), address(0), address(0));
        TestnetProxy houseProxy = new TestnetProxy(address(implementation), address(controller),
            abi.encodeCall(HouseVault.initialize, (address(token), address(this), address(this), address(0), address(0))));
        controller.register(houseProxy);
        HouseVault house = HouseVault(address(houseProxy));
        token.mint(address(this), 10_000); token.approve(address(house), 10_000);
        house.deposit(address(this), 10_000);
        address reserve = address(house.recoveryReserve());
        HouseVaultV2 next = new HouseVaultV2();
        controller.upgrade(houseProxy, address(next), address(next).codehash, "");
        assertEq(address(house.recoveryReserve()), reserve);
        assertEq(token.balanceOf(address(house)), 10_000);
        assertEq(house.totalShares(), 10_000);
        assertEq(house.shares(address(this)), 10_000);
        assertTrue(house.depositsOpen());
        assertEq(house.core(), address(this));
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        house.initialize(address(token), address(8), address(8), address(0), address(0));
    }
}
