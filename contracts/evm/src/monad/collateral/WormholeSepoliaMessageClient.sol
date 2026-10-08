// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WormholeEvmMessageClient} from "../../shared/collateral/WormholeEvmMessageClient.sol";
import {IWormholeCore} from "../../shared/collateral/IWormholeCore.sol";
import {WormholeConfirmationPolicy as Confirmations} from "../../shared/collateral/WormholeConfirmationPolicy.sol";

contract WormholeSepoliaMessageClient is WormholeEvmMessageClient {
    uint16 public confirmationDepth;
    bytes32 private policyHash;

    constructor() WormholeEvmMessageClient(address(0), 0, 0, 0, 0, bytes32(0), 0) {}

    function initializeCustom(address wormhole_, address publisher_, uint16 depth, uint256 version_, uint256 maxAge_) external initializer {
        if (block.chainid != 10143 || publisher_ == address(0) || depth < 5 || depth > 64 || version_ < 2) revert InvalidMessage();
        _initializeWormholeEvmMessageClient(wormhole_, 10009, 10002, 11155111, version_, bytes32(uint256(uint160(publisher_))), maxAge_);
        confirmationDepth = depth;
        policyHash = Confirmations.digest(publisher_, depth);
        bootstrapHash = keccak256(abi.encode(bootstrapHash, policyHash));
    }

    function confirmationPolicyHash() external view override returns (bytes32) { return policyHash; }
    function upgradeContractId() external pure override returns (bytes32) { return keccak256("termbook.WormholeSepoliaMessageClient.v1"); }

    function _acceptConsistency(IWormholeCore.VM memory vm) internal view override returns (bool) {
        if (block.chainid != 10143 || confirmationDepth == 0 || vm.consistencyLevel != 203 || vm.payload.length != 160) return false;
        (,,,, bytes32 signedPolicy) = abi.decode(vm.payload, (bytes32, uint8, bytes32, uint256, bytes32));
        return signedPolicy == policyHash;
    }
}
