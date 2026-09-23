// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICollateralVault} from "./ICollateralVault.sol";
import {SafeTransferLib} from "../SafeTransferLib.sol";

interface IRemoteRecoveryBinding {
    function recoveryVault() external view returns (address);
    function controller() external view returns (address);
    function monadChain() external view returns (uint256);
    function monadCore() external view returns (address);
}

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
    mapping(bytes32 => bytes32) public lockCommitments;
    bool public remoteMode;

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
    event LockCommitted(bytes32 indexed lockId, bytes32 indexed commitment);
    event Released(bytes32 indexed lockId, address indexed recipient, uint256 amount);
    event Seized(bytes32 indexed lockId, address indexed recipient, uint256 amount);
    event RemoteActionApplied(
        bytes32 indexed actionHash, bytes32 indexed lockId, address indexed recipient, uint256 amount, uint8 kind
    );
    event PauseGuardianSet(address indexed guardian);

    constructor(address asset_, uint256 chainId__, address core_) {
        if (asset_.code.length == 0 || core_ == address(0) || chainId__ == 0) revert InvalidAsset();
        asset = asset_;
        chainId_ = chainId__;
        core = core_;
    }

    function isNativeCollateralVault() external pure returns (bool) {
        return false;
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

    function enableRemoteMode() external {
        if (msg.sender != core || remoteMode) revert Unauthorized();
        remoteMode = true;
    }

    function lock(bytes32 lockId, bytes32 creditId, address owner, uint256 amount, address recipient) external {
        if (remoteMode) revert InvalidBinding();
        _lockWithDeadline(lockId, creditId, owner, amount, recipient, type(uint256).max, 1);
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
        if (remoteMode) revert InvalidBinding();
        _lockWithDeadline(lockId, creditId, owner, amount, recipient, deadline, revision);
    }

    function _lockWithDeadline(
        bytes32 lockId,
        bytes32 creditId,
        address owner,
        uint256 amount,
        address recipient,
        uint256 deadline,
        uint256 revision
    ) internal {
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

    function lockRemoteWithDeadline(
        bytes32 lockId,
        bytes32 creditId,
        address borrower,
        address owner,
        uint256 amount,
        address recipient,
        uint256 deadline,
        uint256 revision
    ) external {
        if (borrower == address(0) || lockId == bytes32(0) || chainId_ != block.chainid) {
            revert InvalidBinding();
        }
        address recoveryVault;
        uint256 monadChain;
        address monadCore;
        try IRemoteRecoveryBinding(core).recoveryVault() returns (address configured) {
            recoveryVault = configured;
        } catch {
            revert InvalidBinding();
        }
        try IRemoteRecoveryBinding(core).monadChain() returns (uint256 configured) {
            monadChain = configured;
        } catch {
            revert InvalidBinding();
        }
        try IRemoteRecoveryBinding(core).monadCore() returns (address configured) {
            monadCore = configured;
        } catch {
            revert InvalidBinding();
        }
        if (monadChain == 0 || monadChain == block.chainid || monadCore == address(0)) revert InvalidBinding();
        if (recoveryVault.code.length == 0) revert InvalidBinding();
        try IRemoteRecoveryBinding(recoveryVault).controller() returns (address controller) {
            if (controller != core) revert InvalidBinding();
        } catch {
            revert InvalidBinding();
        }
        _lockWithDeadline(lockId, creditId, owner, amount, recipient, deadline, revision);
        bytes32 commitment =
            keccak256(abi.encode(
                creditId, lockId, borrower, owner, address(this), asset, amount, chainId_, recipient,
                recoveryVault, monadChain, monadCore
            ));
        lockCommitments[lockId] = commitment;
        emit LockCommitted(lockId, commitment);
    }

    function lockCommitmentStorageSlot(bytes32 lockId) external pure returns (bytes32) {
        uint256 slot;
        assembly {
            slot := lockCommitments.slot
        }
        return keccak256(abi.encode(lockId, slot));
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
        delete lockCommitments[lockId];
        if (l.amount == 0) l.released = true;
        releaseUsed[key] = true;
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert InvalidBinding();
        emit Released(lockId, recipient, amount);
    }

    function releaseAuthorized(bytes32 lockId, address recipient, uint256 amount, uint256 nonce, bytes32 actionHash)
        external
    {
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
        delete lockCommitments[lockId];
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
