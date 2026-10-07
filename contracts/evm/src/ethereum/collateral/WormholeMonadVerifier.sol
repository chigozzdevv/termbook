// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WormholeNetworks} from "../../shared/collateral/WormholeNetworks.sol";

import {LightClientVerifier} from "../../shared/collateral/LightClientVerifier.sol";
import {WormholeEvmMessageClient} from "../../shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeTermbookMessages as Messages} from "../../shared/collateral/WormholeTermbookMessages.sol";

contract WormholeMonadVerifier is LightClientVerifier {
    address public monadCore;
    address public monadFactory;
    address public recoveryClient;
    bytes32 public recoveryClientCodeHash;

    constructor(address authorizationClient_, address recoveryClient_, address core_, address factory_) LightClientVerifier(authorizationClient_) {
        if (!(
            authorizationClient_ == address(0)
            && recoveryClient_ == address(0)
            && core_ == address(0)
            && factory_ == address(0)
        )) {
            _initializeWormholeMonadVerifier(authorizationClient_, recoveryClient_, core_, factory_);
        }
    }

    function initialize(address authorizationClient_, address recoveryClient_, address core_, address factory_) external initializer {
        _initializeLightClient(authorizationClient_);
        _initializeWormholeMonadVerifier(authorizationClient_, recoveryClient_, core_, factory_);
    }

    function upgradeContractId() external pure override returns (bytes32) { return keccak256("termbook.WormholeMonadVerifier.v1"); }

    function _initializeWormholeMonadVerifier(address authorizationClient_, address recoveryClient_, address core_, address factory_) private {
        if (
            sourceChainId != WormholeNetworks.monadChain(block.chainid) || core_ == address(0) || factory_ == address(0)
                || recoveryClient_.code.length == 0
                || WormholeEvmMessageClient(authorizationClient_).sourceWormholeChain() != WormholeNetworks.monadWormholeChain(block.chainid)
                || WormholeEvmMessageClient(authorizationClient_).sourceEmitter() != bytes32(uint256(uint160(core_)))
                || WormholeEvmMessageClient(recoveryClient_).sourceWormholeChain() != WormholeNetworks.monadWormholeChain(block.chainid)
                || WormholeEvmMessageClient(recoveryClient_).sourceEmitter() != bytes32(uint256(uint160(factory_)))
                || WormholeEvmMessageClient(recoveryClient_).chainId() != sourceChainId
        ) revert InvalidLightClient();
        monadCore = core_;
        monadFactory = factory_;
        recoveryClient = recoveryClient_;
        recoveryClientCodeHash = recoveryClient_.codehash;
    }

    function wormholeMode() external pure returns (bool) {
        return true;
    }

    function verifyEvent(bytes calldata vaa, bytes calldata proof, address emitter, bytes32 eventDigest)
        external
        view
        override
        returns (bool)
    {
        return emitter == monadCore && eventDigest != bytes32(0) && proof.length == 0
            && _message(lightClient, lightClientCodeHash, vaa, Messages.AUTH, eventDigest);
    }

    function verifyRecoveryOperation(bytes calldata vaa, bytes calldata proof, address emitter, bytes32 eventDigest)
        external
        view
        returns (bool)
    {
        return emitter == monadFactory && eventDigest != bytes32(0) && proof.length == 0
            && _message(recoveryClient, recoveryClientCodeHash, vaa, Messages.RECOVERY, eventDigest);
    }

    function verifyLock(bytes calldata, bytes calldata, address, bytes32) external pure override returns (bool) {
        return false;
    }

    function verifyRecoverySettlement(bytes calldata vaa, bytes calldata proof, address emitter, bytes32 digest)
        external view returns (bool) {
        return emitter == monadFactory && digest != bytes32(0) && proof.length == 0
            && _message(recoveryClient, recoveryClientCodeHash, vaa, Messages.RECOVERY_SETTLED, digest);
    }

    function _message(address client, bytes32 codeHash, bytes calldata vaa, bytes32 domain, bytes32 digest)
        private
        view
        returns (bool)
    {
        if (client.codehash != codeHash) return false;
        try WormholeEvmMessageClient(client).verifiedPayload(vaa) returns (bytes memory payload) {
            if (payload.length != 64) return false;
            (bytes32 actualDomain, bytes32 actualDigest) = abi.decode(payload, (bytes32, bytes32));
            return actualDomain == domain && actualDigest == digest;
        } catch {
            return false;
        }
    }
}
