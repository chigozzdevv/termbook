// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockEvmWormhole, MockSnapshotController, MockSnapshotVault} from "./wormhole-evm-route.t.sol";
import {WormholeEthereumPublisher} from "../../src/ethereum/collateral/WormholeEthereumPublisher.sol";
import {WormholeEthereumVerifier} from "../../src/monad/collateral/WormholeEthereumVerifier.sol";
import {WormholeSepoliaMessageClient} from "../../src/monad/collateral/WormholeSepoliaMessageClient.sol";
import {TestnetProxy} from "../../src/monad/governance/TestnetProxy.sol";
import {WormholeConfirmationPolicy as Confirmations} from "../../src/shared/collateral/WormholeConfirmationPolicy.sol";

contract MockConsistencyConfig {
    mapping(address => bytes32) public getConfiguration;
    function configure(bytes32 value) external { getConfiguration[msg.sender] = value; }
    function change(address emitter, bytes32 value) external { getConfiguration[emitter] = value; }
}
contract ConfirmationController is MockSnapshotController {
    address public governance;
    constructor(address owner) { governance = owner; }
}
contract WormholeConfirmationsTest is Test {
    WormholeEthereumPublisher publisher;
    MockEvmWormhole source;
    MockSnapshotVault vault;
    ConfirmationController controller;
    bytes32 constant LOCK = bytes32(uint256(1));
    bytes32 constant DIGEST = bytes32(uint256(2));
    function setUp() public {
        vm.chainId(11155111); vm.warp(2 days);
        vm.etch(Confirmations.SEPOLIA_CCL, address(new MockConsistencyConfig()).code);
        source = new MockEvmWormhole(10002);
        controller = new ConfirmationController(address(this));
        vault = new MockSnapshotVault(address(controller)); controller.setVault(address(vault)); vault.setLock(LOCK, DIGEST);
        publisher = new WormholeEthereumPublisher(address(vault), address(controller), address(source));
    }
    function client(uint16 depth) private returns (WormholeSepoliaMessageClient c) {
        vm.chainId(10143);
        MockEvmWormhole destination = new MockEvmWormhole(10009);
        address impl = address(new WormholeSepoliaMessageClient());
        c = WormholeSepoliaMessageClient(address(new TestnetProxy(impl, address(this), abi.encodeCall(
            WormholeSepoliaMessageClient.initializeCustom, (address(destination), address(publisher), depth, 2, 7200)))));
    }
    function vaa(uint8 consistency, bytes memory payload) private view returns (bytes memory) {
        return abi.encode(uint16(10002), bytes32(uint256(uint160(address(publisher)))), consistency, uint32(block.timestamp), payload, true);
    }
    function testCustomSnapshotsBindTheAdmittedDepth() public {
        publisher.configureTestnetConfirmations(5); publisher.publishLock(LOCK);
        assertEq(source.lastConsistency(), 203);
        assertEq(MockConsistencyConfig(Confirmations.SEPOLIA_CCL).getConfiguration(address(publisher)), bytes32(hex"01c8000500000000000000000000000000000000000000000000000000000000"));
        WormholeSepoliaMessageClient c = client(5);
        WormholeEthereumVerifier verifier = new WormholeEthereumVerifier(address(c), address(publisher), address(publisher).codehash,
            address(vault), address(vault).codehash, address(controller), address(controller).codehash);
        assertTrue(verifier.verifyLock(vaa(203, source.lastPayload()), "", address(vault), DIGEST));
        assertFalse(verifier.verifyLock(vaa(0, source.lastPayload()), "", address(vault), DIGEST));
        assertFalse(verifier.verifyLock(vaa(200, source.lastPayload()), "", address(vault), DIGEST));
        WormholeSepoliaMessageClient stronger = client(6);
        assertFalse(stronger.verifyFinality(vaa(203, source.lastPayload())));
    }
    function testConfigurationIsGovernedImmutableAndTestnetOnly() public {
        vm.prank(address(123)); vm.expectRevert(WormholeEthereumPublisher.Invalid.selector); publisher.configureTestnetConfirmations(5);
        vm.expectRevert(WormholeEthereumPublisher.Invalid.selector); publisher.configureTestnetConfirmations(4);
        vm.chainId(1); vm.expectRevert(WormholeEthereumPublisher.Invalid.selector); publisher.configureTestnetConfirmations(5);
        vm.chainId(11155111); publisher.configureTestnetConfirmations(5);
        vm.expectRevert(WormholeEthereumPublisher.Invalid.selector); publisher.configureTestnetConfirmations(6);
        MockConsistencyConfig(Confirmations.SEPOLIA_CCL).change(address(publisher), bytes32(uint256(1)));
        vm.expectRevert(WormholeEthereumPublisher.Invalid.selector); publisher.publishLock(LOCK);
    }
    function testDefaultPublicationRetainsFinality() public { publisher.publishLock(LOCK); assertEq(source.lastConsistency(), 0); assertEq(source.lastPayload().length, 128); }
}
