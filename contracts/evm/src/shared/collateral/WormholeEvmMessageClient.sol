// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../ProxyInitializable.sol";

import {IWormholeCore} from "./IWormholeCore.sol";

contract WormholeEvmMessageClient is ProxyInitializable {
    IWormholeCore public wormhole;
    uint256 public chainId;
    uint256 public consensusVersion;
    bytes32 public bootstrapHash;
    uint256 public proofMaxAge;
    uint16 public sourceWormholeChain;
    bytes32 public sourceEmitter;
    bytes32 public wormholeCodeHash;

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
        if (!(
            wormhole_ == address(0)
            && destinationWormholeChain_ == 0
            && sourceWormholeChain_ == 0
            && sourceEvmChain_ == 0
            && version_ == 0
            && emitter_ == bytes32(0)
            && maxAge_ == 0
        )) {
            _initializeWormholeEvmMessageClient(
                wormhole_, destinationWormholeChain_, sourceWormholeChain_, sourceEvmChain_, version_, emitter_, maxAge_
            );
        }
    }

    function initialize(
        address wormhole_,
        uint16 destinationWormholeChain_,
        uint16 sourceWormholeChain_,
        uint256 sourceEvmChain_,
        uint256 version_,
        bytes32 emitter_,
        uint256 maxAge_
    ) external initializer {
        _initializeWormholeEvmMessageClient(wormhole_, destinationWormholeChain_, sourceWormholeChain_, sourceEvmChain_, version_, emitter_, maxAge_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.WormholeEvmMessageClient.v1");
    }

    function _initializeWormholeEvmMessageClient(
        address wormhole_,
        uint16 destinationWormholeChain_,
        uint16 sourceWormholeChain_,
        uint256 sourceEvmChain_,
        uint256 version_,
        bytes32 emitter_,
        uint256 maxAge_
    ) private {
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
