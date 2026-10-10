// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppDeploymentGuard} from "./IAppDeploymentGuard.sol";

// Testnet-only RPC attestation; upgrades can occur between monitor checks.
contract TestnetUpgradeGuard is IAppDeploymentGuard {
    uint256 public constant MAX_LEASE = 180;
    address public immutable proxy;
    address public immutable implementation;
    address public immutable monitor;
    address public immutable governance;
    bytes32 public immutable proxyCodeHash;
    bytes32 public immutable implementationCodeHash;
    uint64 public observedBlock;
    uint64 public validUntil;
    bool public revoked;

    error Invalid();
    error Unauthorized();
    event Renewed(uint64 indexed blockNumber, bytes32 blockHash, uint64 validUntil);
    event Revoked();

    constructor(address proxy_, address implementation_, address monitor_, address governance_) {
        if (block.chainid != 10143 || proxy_.code.length == 0 || implementation_.code.length == 0
            || monitor_ == address(0) || governance_ == address(0)) revert Invalid();
        proxy = proxy_;
        implementation = implementation_;
        monitor = monitor_;
        governance = governance_;
        proxyCodeHash = proxy_.codehash;
        implementationCodeHash = implementation_.codehash;
    }

    function renew(uint64 blockNumber, bytes32 blockHash, uint64 observedAt) external {
        if (msg.sender != monitor) revert Unauthorized();
        if (block.chainid != 10143 || revoked || blockNumber <= observedBlock || blockNumber >= block.number
            || blockHash == bytes32(0) || blockhash(blockNumber) != blockHash
            || observedAt > block.timestamp || block.timestamp - observedAt > 30
            || proxy.codehash != proxyCodeHash || implementation.codehash != implementationCodeHash) revert Invalid();
        observedBlock = blockNumber;
        validUntil = observedAt + uint64(MAX_LEASE);
        emit Renewed(blockNumber, blockHash, validUntil);
    }

    function revoke() external {
        if (msg.sender != monitor && msg.sender != governance) revert Unauthorized();
        revoked = true;
        validUntil = 0;
        emit Revoked();
    }

    function valid(address dependency) external view returns (bool) {
        return block.chainid == 10143 && dependency == proxy && !revoked && block.timestamp < validUntil
            && proxy.codehash == proxyCodeHash && implementation.codehash == implementationCodeHash;
    }
}
