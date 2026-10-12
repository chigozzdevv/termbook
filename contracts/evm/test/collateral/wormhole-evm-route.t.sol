// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IWormholeCore} from "../../src/shared/collateral/IWormholeCore.sol";
import {WormholeEvmMessageClient} from "../../src/shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeEthereumVerifier} from "../../src/monad/collateral/WormholeEthereumVerifier.sol";
import {WormholeMonadVerifier} from "../../src/ethereum/collateral/WormholeMonadVerifier.sol";
import {WormholeEthereumPublisher} from "../../src/ethereum/collateral/WormholeEthereumPublisher.sol";
import {WormholeTermbookMessages as Messages} from "../../src/shared/collateral/WormholeTermbookMessages.sol";
import {WormholeNetworks} from "../../src/shared/collateral/WormholeNetworks.sol";

contract MockEvmWormhole is IWormholeCore {
    uint16 public immutable override chainId;
    uint256 public override messageFee;
    bytes public lastPayload;
    uint8 public lastConsistency;

    constructor(uint16 chain_) {
        chainId = chain_;
    }

    function setFee(uint256 fee) external {
        messageFee = fee;
    }

    function publishMessage(uint32, bytes memory payload, uint8 consistency)
        external
        payable
        override
        returns (uint64)
    {
        require(msg.value == messageFee, "fee");
        lastPayload = payload;
        lastConsistency = consistency;
        return 1;
    }

    function parseAndVerifyVM(bytes calldata encoded)
        external
        pure
        override
        returns (VM memory vm, bool valid, string memory reason)
    {
        (uint16 emitterChain, bytes32 emitter, uint8 consistency, uint32 timestamp, bytes memory payload, bool ok) =
            abi.decode(encoded, (uint16, bytes32, uint8, uint32, bytes, bool));
        vm.version = 1;
        vm.emitterChainId = emitterChain;
        vm.emitterAddress = emitter;
        vm.consistencyLevel = consistency;
        vm.timestamp = timestamp;
        vm.payload = payload;
        valid = ok;
        reason = "";
    }
}

    contract MockSnapshotVault {
        address public core;
        mapping(bytes32 => bytes32) public lockCommitments;
        mapping(bytes32 => bool) public lockExists;

        constructor(address core_) {
            core = core_;
        }

        function setLock(bytes32 id, bytes32 commitment) external {
            lockCommitments[id] = commitment;
            lockExists[id] = commitment != bytes32(0);
        }
    }

    contract MockSnapshotController {
        address public vault;
        uint256 public monadChain = WormholeNetworks.monadChain(block.chainid);
        mapping(bytes32 => bool) public consumed;

        function setVault(address vault_) external {
            vault = vault_;
        }

        function setConsumed(bytes32 actionHash, bool value) external {
            consumed[actionHash] = value;
        }
    }

    contract WormholeEvmRouteTest is Test {
        bytes32 private constant LOCK_ID = bytes32(uint256(1));
        bytes32 private constant COMMITMENT = bytes32(uint256(2));
        bytes32 private constant ACTION = bytes32(uint256(3));
        address private constant CORE = address(0x1234);
        address private constant FACTORY = address(0x5678);

        function _vaa(uint16 chain, address emitter, uint8 consistency, bytes memory payload, bool valid)
            private
            view
            returns (bytes memory)
        {
            return abi.encode(
                chain, bytes32(uint256(uint160(emitter))), consistency, uint32(block.timestamp), payload, valid
            );
        }

        function testEthereumSnapshotMessagesBindStateAndEmitter() external {
            vm.chainId(1);
            vm.warp(2 days);
            MockEvmWormhole sourceWormhole = new MockEvmWormhole(2);
            MockSnapshotController controller = new MockSnapshotController();
            MockSnapshotVault vault = new MockSnapshotVault(address(controller));
            controller.setVault(address(vault));
            WormholeEthereumPublisher publisher =
                new WormholeEthereumPublisher(address(vault), address(controller), address(sourceWormhole));
            vault.setLock(LOCK_ID, COMMITMENT);
            publisher.publishLock(LOCK_ID);
            assertEq(sourceWormhole.lastPayload(), abi.encode(Messages.SNAPSHOT, Messages.LOCK, COMMITMENT, uint256(0)));
            assertEq(sourceWormhole.lastConsistency(), 0);

            vm.chainId(143);
            MockEvmWormhole destinationWormhole = new MockEvmWormhole(48);
            WormholeEvmMessageClient client = new WormholeEvmMessageClient(
                address(destinationWormhole), 48, 2, 1, 1, bytes32(uint256(uint160(address(publisher)))), 1 days
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
            bytes memory lockVaa = _vaa(2, address(publisher), 0, sourceWormhole.lastPayload(), true);
            assertTrue(verifier.verifyLock(lockVaa, "", address(vault), COMMITMENT));
            assertFalse(verifier.verifyLock(lockVaa, "", address(vault), ACTION));
            assertFalse(
                verifier.verifyLock(
                    _vaa(2, CORE, 0, sourceWormhole.lastPayload(), true), "", address(vault), COMMITMENT
                )
            );
            assertFalse(
                verifier.verifyLock(
                    _vaa(2, address(publisher), 0, sourceWormhole.lastPayload(), false), "", address(vault), COMMITMENT
                )
            );

            controller.setConsumed(ACTION, true);
            publisher.publishApplied(ACTION);
            assertTrue(
                verifier.verifyAppliedAction(
                    _vaa(2, address(publisher), 0, sourceWormhole.lastPayload(), true), "", address(vault), ACTION
                )
            );
            vm.expectRevert(WormholeEthereumPublisher.Invalid.selector);
            publisher.publishUnconsumed(ACTION, block.timestamp - 1);
            controller.setConsumed(ACTION, false);
            publisher.publishUnconsumed(ACTION, block.timestamp - 1);
            assertTrue(
                verifier.verifyUnconsumedAction(
                    _vaa(2, address(publisher), 0, sourceWormhole.lastPayload(), true),
                    "",
                    address(controller),
                    ACTION,
                    block.timestamp - 1
                )
            );
            assertFalse(
                verifier.verifyUnconsumedAction(
                    _vaa(2, address(publisher), 0, sourceWormhole.lastPayload(), true),
                    "",
                    address(controller),
                    ACTION,
                    block.timestamp - 2
                )
            );
            vm.expectRevert(WormholeEthereumPublisher.Invalid.selector);
            publisher.publishUnconsumed(ACTION, block.timestamp - 1);
            vm.warp(block.timestamp + 1 hours);
            publisher.publishUnconsumed(ACTION, block.timestamp - 1 hours - 1);
            vm.warp(block.timestamp + 1 days + 1);
            assertFalse(verifier.verifyLock(lockVaa, "", address(vault), COMMITMENT));
        }

        function testMonadAuthorizationAndRecoveryHaveSeparateEmitters() external {
            vm.chainId(1);
            vm.warp(2 days);
            MockEvmWormhole wormhole = new MockEvmWormhole(2);
            WormholeEvmMessageClient coreClient =
                new WormholeEvmMessageClient(address(wormhole), 2, 48, 143, 1, bytes32(uint256(uint160(CORE))), 1 days);
            WormholeEvmMessageClient factoryClient =
                new WormholeEvmMessageClient(
                address(wormhole), 2, 48, 143, 1, bytes32(uint256(uint160(FACTORY))), 1 days
            );
            WormholeMonadVerifier verifier =
                new WormholeMonadVerifier(address(coreClient), address(factoryClient), CORE, FACTORY);
            bytes32 digest = keccak256("action");
            bytes memory auth = _vaa(48, CORE, 0, abi.encode(Messages.AUTH, digest), true);
            bytes memory recovery = _vaa(48, FACTORY, 0, abi.encode(Messages.RECOVERY, digest), true);
            assertTrue(verifier.verifyEvent(auth, "", CORE, digest));
            assertFalse(verifier.verifyRecoverySettlement(recovery, "", FACTORY, digest));
            bytes memory settled = _vaa(48, FACTORY, 0, abi.encode(Messages.RECOVERY_SETTLED, digest), true);
            assertTrue(verifier.verifyRecoverySettlement(settled, "", FACTORY, digest));
            assertFalse(verifier.verifyRecoveryOperation(settled, "", FACTORY, digest));
            assertFalse(verifier.verifyRecoverySettlement(settled, "", CORE, digest));
            assertFalse(verifier.verifyEvent(recovery, "", CORE, digest));
            assertTrue(verifier.verifyRecoveryOperation(recovery, "", FACTORY, digest));
            assertFalse(verifier.verifyRecoveryOperation(auth, "", FACTORY, digest));
            assertFalse(
                verifier.verifyEvent(_vaa(48, CORE, 1, abi.encode(Messages.AUTH, digest), true), "", CORE, digest)
            );
        }
    }
