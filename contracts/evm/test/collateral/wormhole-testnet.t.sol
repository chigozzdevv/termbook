// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockEvmWormhole, MockSnapshotController, MockSnapshotVault} from "./wormhole-evm-route.t.sol";
import {WormholeEvmMessageClient} from "../../src/shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeEthereumPublisher} from "../../src/ethereum/collateral/WormholeEthereumPublisher.sol";
import {WormholeEthereumVerifier} from "../../src/monad/collateral/WormholeEthereumVerifier.sol";
import {WormholeMonadVerifier} from "../../src/ethereum/collateral/WormholeMonadVerifier.sol";
import {LightClientVerifier} from "../../src/shared/collateral/LightClientVerifier.sol";
import {WormholeTermbookMessages as Messages} from "../../src/shared/collateral/WormholeTermbookMessages.sol";

contract WormholeTestnetTest is Test {
    function testSepoliaSnapshotIsVerifiedOnMonadTestnet() external {
        vm.chainId(11155111);
        vm.warp(2 days);
        MockEvmWormhole source = new MockEvmWormhole(10002);
        MockSnapshotController controller = new MockSnapshotController();
        MockSnapshotVault vault = new MockSnapshotVault(address(controller));
        controller.setVault(address(vault));
        WormholeEthereumPublisher publisher =
            new WormholeEthereumPublisher(address(vault), address(controller), address(source));
        bytes32 digest = keccak256("lock");
        bytes32 id = keccak256("id");
        vault.setLock(id, digest);
        publisher.publishLock(id);
        bytes memory payload = source.lastPayload();
        vm.chainId(10143);
        MockEvmWormhole destination = new MockEvmWormhole(10009);
        WormholeEvmMessageClient client = new WormholeEvmMessageClient(
            address(destination), 10009, 10002, 11155111, 1, bytes32(uint256(uint160(address(publisher)))), 7200
        );
        WormholeEthereumVerifier verifier = new WormholeEthereumVerifier(
            address(client),
            address(publisher),
            address(publisher).codehash,
            address(vault),
            address(vault).codehash,
            address(controller),
            address(controller).codehash
        );
        bytes memory vaa = abi.encode(
            uint16(10002),
            bytes32(uint256(uint160(address(publisher)))),
            uint8(0),
            uint32(block.timestamp),
            payload,
            true
        );
        assertTrue(verifier.verifyLock(vaa, "", address(vault), digest));
        assertFalse(verifier.verifyLock(vaa, "", address(vault), keccak256("wrong")));
    }

    function testMainnetSnapshotCannotBeAdmittedOnTestnet() external {
        vm.chainId(10143);
        MockEvmWormhole destination = new MockEvmWormhole(10009);
        WormholeEvmMessageClient client =
            new WormholeEvmMessageClient(address(destination), 10009, 2, 1, 1, bytes32(uint256(1)), 7200);
        vm.expectRevert(LightClientVerifier.InvalidLightClient.selector);
        new WormholeEthereumVerifier(
            address(client),
            address(1),
            bytes32(uint256(1)),
            address(2),
            bytes32(uint256(2)),
            address(3),
            bytes32(uint256(3))
        );
    }

    function testMonadTestnetAuthorizationIsVerifiedOnSepolia() external {
        vm.chainId(11155111);
        vm.warp(2 days);
        MockEvmWormhole destination = new MockEvmWormhole(10002);
        address core = address(1);
        address factory = address(2);
        WormholeEvmMessageClient authorization = new WormholeEvmMessageClient(
            address(destination), 10002, 10009, 10143, 1, bytes32(uint256(uint160(core))), 7200
        );
        WormholeEvmMessageClient recovery = new WormholeEvmMessageClient(
            address(destination), 10002, 10009, 10143, 1, bytes32(uint256(uint160(factory))), 7200
        );
        WormholeMonadVerifier verifier =
            new WormholeMonadVerifier(address(authorization), address(recovery), core, factory);
        bytes32 digest = keccak256("authorization");
        bytes memory vaa = abi.encode(
            uint16(10009),
            bytes32(uint256(uint160(core))),
            uint8(0),
            uint32(block.timestamp),
            abi.encode(Messages.AUTH, digest),
            true
        );
        assertTrue(verifier.verifyEvent(vaa, "", core, digest));
        assertFalse(verifier.verifyEvent(vaa, "", factory, digest));
    }
}
