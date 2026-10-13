// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WormholeEvmMessageClient} from "./WormholeEvmMessageClient.sol";
import {WormholeNetworks} from "./WormholeNetworks.sol";
import {IWormholeCore} from "./IWormholeCore.sol";
import {WormholeConfirmationPolicy as Confirmations} from "./WormholeConfirmationPolicy.sol";

contract WormholeEvmPolicyClient is WormholeEvmMessageClient {
    bytes32 private policyHash;

    constructor() WormholeEvmMessageClient(address(0), 0, 0, 0, 0, bytes32(0), 0) {}

    function initializeSafe(address wormhole_, uint256 sourceChain_, address publisher_, uint256 maxAge_) external initializer {
        if (block.chainid != 10143 || sourceChain_ != 84532 || publisher_ == address(0)) revert InvalidMessage();
        _initializeWormholeEvmMessageClient(wormhole_, 10009, WormholeNetworks.evmWormholeChain(sourceChain_),
            sourceChain_, 3, bytes32(uint256(uint160(publisher_))), maxAge_);
        policyHash = Confirmations.safeDigest(sourceChain_, publisher_);
        bootstrapHash = keccak256(abi.encode(bootstrapHash, policyHash));
    }

    function confirmationPolicyHash() external view override returns (bytes32) { return policyHash; }
    function upgradeContractId() external pure override returns (bytes32) { return keccak256("termbook.WormholeEvmPolicyClient.v1"); }

    function _acceptConsistency(IWormholeCore.VM memory vm) internal view override returns (bool) {
        if (block.chainid != 10143 || chainId != 84532 || consensusVersion != 3 || policyHash == bytes32(0)
            || vm.consistencyLevel != 201 || vm.payload.length != 160) return false;
        (,,,, bytes32 signedPolicy) = abi.decode(vm.payload, (bytes32, uint8, bytes32, uint256, bytes32));
        return signedPolicy == policyHash;
    }
}
