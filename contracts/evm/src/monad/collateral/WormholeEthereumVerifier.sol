// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WormholeNetworks} from "../../shared/collateral/WormholeNetworks.sol";

import {LightClientVerifier} from "../../shared/collateral/LightClientVerifier.sol";
import {WormholeEvmMessageClient} from "../../shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeTermbookMessages as Messages} from "../../shared/collateral/WormholeTermbookMessages.sol";

contract WormholeEthereumVerifier is LightClientVerifier {
    address public publisher;
    bytes32 public publisherCodeHash;
    address public sourceVault;
    address public sourceController;
    bytes32 public sourceVaultCodeHash;
    bytes32 public sourceControllerCodeHash;

    constructor(
        address client_,
        address publisher_,
        bytes32 publisherCodeHash_,
        address vault_,
        bytes32 vaultCodeHash_,
        address controller_,
        bytes32 controllerCodeHash_
    ) LightClientVerifier(client_) {
        if (!(
            client_ == address(0)
            && publisher_ == address(0)
            && publisherCodeHash_ == bytes32(0)
            && vault_ == address(0)
            && vaultCodeHash_ == bytes32(0)
            && controller_ == address(0)
            && controllerCodeHash_ == bytes32(0)
        )) {
            _initializeWormholeEthereumVerifier(
                client_, publisher_, publisherCodeHash_, vault_, vaultCodeHash_, controller_, controllerCodeHash_
            );
        }
    }

    function initialize(
        address client_,
        address publisher_,
        bytes32 publisherCodeHash_,
        address vault_,
        bytes32 vaultCodeHash_,
        address controller_,
        bytes32 controllerCodeHash_
    ) external initializer {
        _initializeLightClient(client_);
        _initializeWormholeEthereumVerifier(client_, publisher_, publisherCodeHash_, vault_, vaultCodeHash_, controller_, controllerCodeHash_);
    }

    function upgradeContractId() external pure override returns (bytes32) { return keccak256("termbook.WormholeEthereumVerifier.v1"); }

    function _initializeWormholeEthereumVerifier(
        address client_,
        address publisher_,
        bytes32 publisherCodeHash_,
        address vault_,
        bytes32 vaultCodeHash_,
        address controller_,
        bytes32 controllerCodeHash_
    ) private {
        if (
            !WormholeNetworks.isEvmSource(sourceChainId, block.chainid) || publisher_ == address(0) || publisherCodeHash_ == bytes32(0) || vault_ == address(0)
                || vaultCodeHash_ == bytes32(0) || controller_ == address(0) || controllerCodeHash_ == bytes32(0)
                || WormholeEvmMessageClient(client_).sourceWormholeChain() != WormholeNetworks.evmWormholeChain(sourceChainId)
                || WormholeEvmMessageClient(client_).sourceEmitter() != bytes32(uint256(uint160(publisher_)))
        ) revert InvalidLightClient();
        if (vault_ == controller_) revert InvalidLightClient();
        publisher = publisher_;
        publisherCodeHash = publisherCodeHash_;
        sourceVault = vault_;
        sourceController = controller_;
        sourceVaultCodeHash = vaultCodeHash_;
        sourceControllerCodeHash = controllerCodeHash_;
    }

    function wormholeMode() external pure returns (bool) {
        return true;
    }

    function verifyEvent(bytes calldata, bytes calldata, address, bytes32) external pure override returns (bool) {
        return false;
    }

    function verifyLock(bytes calldata vaa, bytes calldata proof, address vault, bytes32 lockDigest)
        external
        view
        override
        returns (bool)
    {
        return vault == sourceVault && lockDigest != bytes32(0) && proof.length == 0
            && _snapshot(vaa, Messages.LOCK, lockDigest, 0);
    }

    function verifyAppliedAction(bytes calldata vaa, bytes calldata proof, address vault, bytes32 actionHash)
        external
        view
        returns (bool)
    {
        return vault == sourceVault && actionHash != bytes32(0) && proof.length == 0
            && _snapshot(vaa, Messages.APPLIED, actionHash, 0);
    }

    function verifyUnconsumedAction(
        bytes calldata vaa,
        bytes calldata proof,
        address controller,
        bytes32 actionHash,
        uint256 deadline
    ) external view returns (bool) {
        return controller == sourceController && actionHash != bytes32(0) && deadline != 0 && proof.length == 0
            && _snapshot(vaa, Messages.UNCONSUMED, actionHash, deadline);
    }

    function _snapshot(bytes calldata vaa, uint8 kind, bytes32 digest, uint256 deadline) private view returns (bool) {
        if (lightClient.codehash != lightClientCodeHash) return false;
        try WormholeEvmMessageClient(lightClient).verifiedPayload(vaa) returns (bytes memory payload) {
            if (payload.length != 128 && payload.length != 160) return false;
            if (payload.length == 160) {
                (,,,, bytes32 policy) = abi.decode(payload, (bytes32, uint8, bytes32, uint256, bytes32));
                if (policy == bytes32(0) || policy != WormholeEvmMessageClient(lightClient).confirmationPolicyHash()) return false;
            }
            (bytes32 domain, uint8 actualKind, bytes32 actualDigest, uint256 actualDeadline) =
                abi.decode(payload, (bytes32, uint8, bytes32, uint256));
            return
                domain == Messages.SNAPSHOT && actualKind == kind && actualDigest == digest
                    && actualDeadline == deadline;
        } catch {
            return false;
        }
    }

    function verifyRecoveryClearance(bytes calldata vaa, bytes calldata proof,
        bytes32 creditId, address recoveryVault, bytes32 seizureHash) external view returns (bool) {
        return creditId != bytes32(0) && recoveryVault != address(0) && seizureHash != bytes32(0)
            && proof.length == 0 && _snapshot(vaa, Messages.RECOVERY_CLEAR,
                keccak256(abi.encode(creditId, recoveryVault, seizureHash)), 0);
    }

    function verifyRecoveryRefunded(bytes calldata vaa, bytes calldata proof, bytes32 digest)
        external view returns (bool) {
        return digest != bytes32(0) && proof.length == 0 && _snapshot(vaa, Messages.RECOVERY_REFUNDED, digest, 0);
    }
}
