// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWormholeCore} from "./IWormholeCore.sol";

contract WormholeEvmMessageClient {
    IWormholeCore public immutable wormhole;
    uint256 public immutable chainId;
    uint256 public immutable consensusVersion;
    bytes32 public immutable bootstrapHash;
    uint256 public immutable proofMaxAge;
    uint16 public immutable sourceWormholeChain;
    bytes32 public immutable sourceEmitter;
    bytes32 public immutable wormholeCodeHash;

    error InvalidMessage();

    constructor(
        address wormhole_,
        uint16 destinationWormholeChain_,
        uint16 sourceWormholeChain_,
        uint256 sourceEvmChain_,
        uint256 version_,
        bytes32 emitter_,
        uint256 maxAge_
    ) {
        if (
            wormhole_.code.length == 0 || IWormholeCore(wormhole_).chainId() != destinationWormholeChain_
                || destinationWormholeChain_ == sourceWormholeChain_ || sourceWormholeChain_ == 0
                || sourceEvmChain_ == 0 || version_ == 0 || emitter_ == bytes32(0) || maxAge_ == 0
        ) revert InvalidMessage();
        wormhole = IWormholeCore(wormhole_);
        wormholeCodeHash = wormhole_.codehash;
        sourceWormholeChain = sourceWormholeChain_;
        sourceEmitter = emitter_;
        chainId = sourceEvmChain_;
        consensusVersion = version_;
        proofMaxAge = maxAge_;
        bootstrapHash = keccak256(
            abi.encode(wormhole_, destinationWormholeChain_, sourceWormholeChain_, sourceEvmChain_, emitter_)
        );
    }

    function headerTimestamp(bytes calldata vaa) external view returns (uint256) {
        return _verified(vaa).timestamp;
    }

    function verifyFinality(bytes calldata vaa) external view returns (bool) {
        try this.verifiedPayload(vaa) returns (bytes memory) {
            return true;
        } catch {
            return false;
        }
    }

    function headerRoot(bytes calldata vaa) external view returns (bytes32) {
        return _verified(vaa).hash;
    }

    function verifyInclusion(bytes calldata, bytes32) external pure returns (bool) {
        return false;
    }

    function proofLeaf(bytes calldata) external pure returns (bytes32) {
        revert InvalidMessage();
    }

    function verifyEvent(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) {
        return false;
    }

    function verifyLock(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) {
        return false;
    }

    function verifiedPayload(bytes calldata vaa) external view returns (bytes memory) {
        return _verified(vaa).payload;
    }

    function _verified(bytes calldata vaa) private view returns (IWormholeCore.VM memory vm) {
        if (vaa.length == 0 || vaa.length > 96_000 || address(wormhole).codehash != wormholeCodeHash) {
            revert InvalidMessage();
        }
        bool valid;
        try wormhole.parseAndVerifyVM(vaa) returns (IWormholeCore.VM memory parsed, bool ok, string memory) {
            vm = parsed;
            valid = ok;
        } catch {
            revert InvalidMessage();
        }
        if (
            !valid || vm.version != 1 || vm.emitterChainId != sourceWormholeChain || vm.emitterAddress != sourceEmitter
                || vm.consistencyLevel != 0 || vm.timestamp == 0 || vm.timestamp > block.timestamp
                || block.timestamp - vm.timestamp > proofMaxAge
        ) revert InvalidMessage();
    }
}
