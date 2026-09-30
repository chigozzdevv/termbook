// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LightClientVerifier} from "../../shared/collateral/LightClientVerifier.sol";
import {WormholeEvmMessageClient} from "../../shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeTermbookMessages as Messages} from "../../shared/collateral/WormholeTermbookMessages.sol";

contract WormholeMonadVerifier is LightClientVerifier {
    address public immutable monadCore;
    address public immutable monadFactory;
    address public immutable recoveryClient;
    bytes32 public immutable recoveryClientCodeHash;

    constructor(address authorizationClient_, address recoveryClient_, address core_, address factory_)
        LightClientVerifier(authorizationClient_)
    {
        if (
            sourceChainId == block.chainid || sourceChainId == 0 || core_ == address(0) || factory_ == address(0)
                || recoveryClient_.code.length == 0
                || WormholeEvmMessageClient(authorizationClient_).sourceWormholeChain() != 48
                || WormholeEvmMessageClient(authorizationClient_).sourceEmitter() != bytes32(uint256(uint160(core_)))
                || WormholeEvmMessageClient(recoveryClient_).sourceWormholeChain() != 48
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
