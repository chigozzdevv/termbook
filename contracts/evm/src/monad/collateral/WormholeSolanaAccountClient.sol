// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWormholeCore} from "./IWormholeCore.sol";

contract WormholeSolanaAccountClient {
    bytes32 private constant SNAPSHOT_DOMAIN = keccak256("Termbook Solana snapshot v1");
    uint16 private constant SOLANA_WORMHOLE_CHAIN = 1;
    uint8 private constant FINALIZED = 1;
    uint256 private constant MAX_VAA_SIZE = 96_000;
    uint256 private constant MAX_ACCOUNT_SIZE = 1_024;

    IWormholeCore public immutable wormhole;
    bytes32 public immutable sourceGenesis;
    bytes32 public immutable sourceProgram;
    bytes32 public immutable sourceEmitter;
    bytes32 public immutable sourceProgramDataHash;
    uint256 public immutable chainId;
    uint256 public immutable consensusVersion;
    bytes32 public immutable bootstrapHash;
    uint256 public immutable proofMaxAge;

    error InvalidWormholeMessage();

    constructor(
        address wormhole_,
        uint256 sourceChain_,
        uint256 version_,
        bytes32 genesis_,
        bytes32 program_,
        bytes32 emitter_,
        bytes32 programDataHash_,
        uint256 maxAge_
    ) {
        if (
            wormhole_.code.length == 0 || IWormholeCore(wormhole_).chainId() != 48
                || sourceChain_ == 0 || version_ == 0 || genesis_ == bytes32(0)
                || program_ == bytes32(0) || emitter_ == bytes32(0)
                || programDataHash_ == bytes32(0) || maxAge_ == 0
        ) revert InvalidWormholeMessage();
        wormhole = IWormholeCore(wormhole_);
        chainId = sourceChain_;
        consensusVersion = version_;
        sourceGenesis = genesis_;
        sourceProgram = program_;
        sourceEmitter = emitter_;
        sourceProgramDataHash = programDataHash_;
        proofMaxAge = maxAge_;
        bootstrapHash = keccak256(abi.encode(genesis_, program_, emitter_, programDataHash_, wormhole_));
    }

    function headerTimestamp(bytes calldata vaa) external view returns (uint256) {
        return _verified(vaa).timestamp;
    }

    function verifyFinality(bytes calldata vaa) external view returns (bool) {
        try this.verifiedMessage(vaa) returns (uint32 timestamp, bytes32) {
            return timestamp != 0 && timestamp <= block.timestamp && block.timestamp - timestamp <= proofMaxAge;
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
        revert InvalidWormholeMessage();
    }

    function verifyEvent(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) {
        return false;
    }

    function verifyLock(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) {
        return false;
    }

    function verifiedMessage(bytes calldata vaa) external view returns (uint32 timestamp, bytes32 hash) {
        IWormholeCore.VM memory vm = _verified(vaa);
        return (vm.timestamp, vm.hash);
    }

    function verifiedAccount(bytes calldata vaa, bytes calldata proof, bytes32 account)
        external view returns (bytes32 owner, uint64 lamports, bytes memory data)
    {
        if (proof.length != 1 || proof[0] != 0x01 || account == bytes32(0)) {
            revert InvalidWormholeMessage();
        }
        IWormholeCore.VM memory vm = _verified(vaa);
        (bytes32 snapshotAccount, uint64 balance, bytes memory snapshotData) = _snapshot(vm.payload);
        if (snapshotAccount != account) revert InvalidWormholeMessage();
        return (sourceProgram, balance, snapshotData);
    }

    function verifiedProgramDataHash(bytes calldata vaa, bytes calldata proof, bytes32 program)
        external view returns (bytes32)
    {
        if (proof.length != 1 || proof[0] != 0x02 || program != sourceProgram) {
            revert InvalidWormholeMessage();
        }
        _verified(vaa);
        return sourceProgramDataHash;
    }

    function _verified(bytes calldata vaa) private view returns (IWormholeCore.VM memory vm) {
        if (vaa.length == 0 || vaa.length > MAX_VAA_SIZE) revert InvalidWormholeMessage();
        bool valid;
        try wormhole.parseAndVerifyVM(vaa) returns (IWormholeCore.VM memory parsed, bool ok, string memory) {
            vm = parsed;
            valid = ok;
        } catch {
            revert InvalidWormholeMessage();
        }
        if (
            !valid || vm.version != 1 || vm.emitterChainId != SOLANA_WORMHOLE_CHAIN
                || vm.emitterAddress != sourceEmitter || vm.consistencyLevel != FINALIZED
                || vm.timestamp == 0 || vm.timestamp > block.timestamp
                || block.timestamp - vm.timestamp > proofMaxAge
        ) revert InvalidWormholeMessage();
    }

    function _snapshot(bytes memory payload)
        private pure returns (bytes32 account, uint64 lamports, bytes memory data)
    {
        if (payload.length < 76 || payload.length > 76 + MAX_ACCOUNT_SIZE) revert InvalidWormholeMessage();
        bytes32 domain;
        uint32 length;
        assembly {
            domain := mload(add(payload, 32))
            account := mload(add(payload, 64))
        }
        if (domain != SNAPSHOT_DOMAIN || account == bytes32(0)) revert InvalidWormholeMessage();
        for (uint256 i; i < 8; ++i) lamports |= uint64(uint256(uint8(payload[64 + i])) << (i * 8));
        for (uint256 i; i < 4; ++i) length |= uint32(uint256(uint8(payload[72 + i])) << (i * 8));
        if (length == 0 || length > MAX_ACCOUNT_SIZE || payload.length != 76 + length) {
            revert InvalidWormholeMessage();
        }
        data = new bytes(length);
        for (uint256 i; i < length; ++i) data[i] = payload[76 + i];
    }
}
