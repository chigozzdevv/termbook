// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LightClientVerifier, IExecutionReceiptsLightClient} from "../../shared/collateral/LightClientVerifier.sol";
import {EvmReceiptProof} from "../../shared/collateral/EvmReceiptProof.sol";

contract MonadVerifier is LightClientVerifier {
    constructor(address lightClient_) LightClientVerifier(lightClient_) {}

    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external
        view
        override
        returns (bool)
    {
        return _verifyReceiptEvent(header, proof, emitter, eventDigest, true);
    }

    function verifyRecoveryOperation(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external
        view
        returns (bool)
    {
        if (emitter == address(0) || eventDigest == bytes32(0) || proof.length == 0 || proof.length > 160_000) {
            return false;
        }
        if (!this.verifyFinality(header)) return false;
        bytes32 receiptsRoot;
        try IExecutionReceiptsLightClient(lightClient).finalizedExecutionReceiptsRoot(header) returns (bytes32 root) {
            receiptsRoot = root;
        } catch {
            return false;
        }
        if (receiptsRoot == bytes32(0)) return false;
        try this.verifyRecoveryOperationInRoot(receiptsRoot, proof, emitter, eventDigest) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function verifyRecoveryOperationInRoot(
        bytes32 receiptsRoot,
        bytes calldata proof,
        address emitter,
        bytes32 eventDigest
    ) external view returns (bool) {
        if (msg.sender != address(this)) return false;
        return EvmReceiptProof.verifyRecoveryOperation(receiptsRoot, proof, emitter, eventDigest);
    }
}
