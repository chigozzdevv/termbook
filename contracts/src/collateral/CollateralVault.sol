// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICollateralVault} from "./ICollateralVault.sol";
import {SafeTransferLib} from "../shared/SafeTransferLib.sol";

contract CollateralVault is ICollateralVault {
    using SafeTransferLib for address;

    struct Lock {
        bytes32 creditId;
        address owner;
        uint256 amount;
        address recipient;
        bool released;
        bool seized;
    }

    address public immutable asset;
    uint256 public immutable chainId_;
    address public immutable core;
    address public pauseGuardian;
    bool public paused;
    mapping(bytes32 => Lock) public locks;
    mapping(bytes32 => bool) public lockExists;
    mapping(bytes32 => uint256) public lockDeadline;
    mapping(bytes32 => uint256) public lockRevision;
    mapping(bytes32 => bool) public releaseUsed;

    error Exists();
    error Unknown();
    error Used();
    error Unauthorized();
    error Expired();
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidAsset();
    error InvalidBinding();

    event Locked(bytes32 indexed lockId, bytes32 indexed creditId, address indexed owner, uint256 amount);
    event Released(bytes32 indexed lockId, address indexed recipient, uint256 amount);
    event Seized(bytes32 indexed lockId, address indexed recipient, uint256 amount);
    event RemoteActionApplied(bytes32 indexed actionHash, bytes32 indexed lockId, address indexed recipient, uint256 amount, uint8 kind);
    event PauseGuardianSet(address indexed guardian);

    constructor(address asset_, uint256 chainId__, address core_) {
        if (asset_.code.length == 0 || core_ == address(0) || chainId__ == 0) revert InvalidAsset();
        asset = asset_;
        chainId_ = chainId__;
        core = core_;
    }

    function setPaused(bool value) external {
        if (msg.sender != core && msg.sender != pauseGuardian) revert Unauthorized();
        paused = value;
    }

    function setPauseGuardian(address guardian) external {
        if (msg.sender != core || guardian == address(0) || guardian.code.length == 0) revert Unauthorized();
        pauseGuardian = guardian;
        emit PauseGuardianSet(guardian);
    }

    function lock(bytes32 lockId, bytes32 creditId, address owner, uint256 amount, address recipient) external {
        lockWithDeadline(lockId, creditId, owner, amount, recipient, type(uint256).max, 1);
    }

    function lockWithDeadline(
        bytes32 lockId,
        bytes32 creditId,
        address owner,
        uint256 amount,
        address recipient,
        uint256 deadline,
        uint256 revision
    ) public {
        if (lockExists[lockId]) revert Exists();
        if (paused || msg.sender != owner || owner == address(0) || creditId == bytes32(0)) revert Unauthorized();
        if (amount == 0 || revision == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        if (block.timestamp > deadline) revert Expired();
        locks[lockId] = Lock(creditId, owner, amount, recipient, false, false);
        lockExists[lockId] = true;
        lockDeadline[lockId] = deadline;
        lockRevision[lockId] = revision;
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(owner, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert InvalidAmount();
        emit Locked(lockId, creditId, owner, amount);
    }

    function release(bytes32 lockId, address recipient, uint256 amount, uint256 nonce) public {
        if (msg.sender != core) revert Unauthorized();
        bytes32 key = keccak256(abi.encode(lockId, recipient, amount, nonce));
        if (releaseUsed[key]) revert Used();
        Lock storage l = locks[lockId];
        if (!lockExists[lockId]) revert Unknown();
        if (l.released || l.seized) revert Used();
        if (recipient != l.recipient || amount == 0 || amount > l.amount) revert InvalidBinding();
        l.amount -= amount;
        if (l.amount == 0) l.released = true;
        releaseUsed[key] = true;
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert InvalidBinding();
        emit Released(lockId, recipient, amount);
    }

    function releaseAuthorized(bytes32 lockId, address recipient, uint256 amount, uint256 nonce, bytes32 actionHash) external {
        if (actionHash == bytes32(0)) revert InvalidBinding();
        release(lockId, recipient, amount, nonce);
        emit RemoteActionApplied(actionHash, lockId, recipient, amount, 0);
    }

    function seize(bytes32 lockId, address recipient, uint256 amount) public {
        if (msg.sender != core) revert Unauthorized();
        Lock storage l = locks[lockId];
        if (!lockExists[lockId]) revert Unknown();
        if (l.released || l.seized || recipient == address(0) || amount == 0 || amount > l.amount) {
            revert InvalidBinding();
        }
        l.amount -= amount;
        if (l.amount == 0) l.seized = true;
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert InvalidBinding();
        emit Seized(lockId, recipient, amount);
    }

    function seizeAuthorized(bytes32 lockId, address recipient, uint256 amount, bytes32 actionHash) external {
        if (actionHash == bytes32(0)) revert InvalidBinding();
        seize(lockId, recipient, amount);
        emit RemoteActionApplied(actionHash, lockId, recipient, amount, 1);
    }

    function lockInfo(bytes32 lockId)
        external
        view
        returns (
            bytes32 creditId,
            address owner,
            address lockAsset,
            uint256 sourceChain,
            uint256 amount,
            address recipient,
            uint256 deadline,
            uint256 revision,
            bool exists,
            bool released,
            bool seized
        )
    {
        Lock memory l = locks[lockId];
        return (
            l.creditId,
            l.owner,
            asset,
            chainId_,
            l.amount,
            l.recipient,
            lockDeadline[lockId],
            lockRevision[lockId],
            lockExists[lockId],
            l.released,
            l.seized
        );
    }

    function consumed(bytes32 lockId) external view returns (bool) {
        Lock memory l = locks[lockId];
        return l.released || l.seized;
    }
}
