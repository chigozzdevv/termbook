// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICollateralVault} from "../../shared/collateral/ICollateralVault.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

contract NativeCollateralVault is ICollateralVault {
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

    bool private unwrapping;
    uint256 private entered;

    error Exists();
    error Unknown();
    error Used();
    error Unauthorized();
    error Expired();
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidAsset();
    error InvalidBinding();
    error InvalidChain();
    error NativeDepositRequired();
    error NativeTransferFailed();
    error Reentrant();

    event ToppedUp(bytes32 indexed lockId, address indexed payer, uint256 amount);
    event Locked(bytes32 indexed lockId, bytes32 indexed creditId, address indexed owner, uint256 amount);
    event Released(bytes32 indexed lockId, address indexed recipient, uint256 amount);
    event Seized(bytes32 indexed lockId, address indexed recipient, uint256 amount);
    event PauseGuardianSet(address indexed guardian);

    modifier nonReentrant() {
        if (entered != 0) revert Reentrant();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address wrappedNative, uint256 sourceChain, address core_) {
        if (wrappedNative.code.length == 0 || core_ == address(0) || sourceChain == 0) revert InvalidAsset();
        if (sourceChain != block.chainid) revert InvalidChain();
        asset = wrappedNative;
        chainId_ = sourceChain;
        core = core_;
    }

    function isNativeCollateralVault() external pure returns (bool) {
        return true;
    }

    receive() external payable {
        if (msg.sender != asset || !unwrapping) revert NativeDepositRequired();
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

    function lock(bytes32, bytes32, address, uint256, address) external pure {
        revert NativeDepositRequired();
    }

    function lockNative(bytes32 lockId, bytes32 creditId, address owner, uint256 amount, address recipient)
        external
        payable
    {
        lockNativeWithDeadline(lockId, creditId, owner, amount, recipient, type(uint256).max, 1);
    }

    function lockNativeWithDeadline(
        bytes32 lockId,
        bytes32 creditId,
        address owner,
        uint256 amount,
        address recipient,
        uint256 deadline,
        uint256 revision
    ) public payable nonReentrant {
        _checkChain();
        if (lockExists[lockId]) revert Exists();
        if (paused || msg.sender != owner || owner == address(0) || creditId == bytes32(0)) revert Unauthorized();
        if (amount == 0 || msg.value != amount || revision == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        if (block.timestamp > deadline) revert Expired();

        lockExists[lockId] = true;
        locks[lockId] = Lock(creditId, owner, amount, recipient, false, false);
        lockDeadline[lockId] = deadline;
        lockRevision[lockId] = revision;

        uint256 nativeBefore = address(this).balance - amount;
        uint256 wrappedBefore = asset.balanceOf(address(this));
        IWrappedNative(asset).deposit{value: amount}();
        if (asset.balanceOf(address(this)) - wrappedBefore != amount || address(this).balance != nativeBefore) {
            revert InvalidAmount();
        }
        emit Locked(lockId, creditId, owner, amount);
    }

    function topUpNative(bytes32 lockId, address payer, uint256 amount) external payable nonReentrant {
        _onlyCore();
        Lock storage l = locks[lockId];
        if (paused || !lockExists[lockId] || l.released || l.seized || payer == address(0)
            || amount == 0 || msg.value != amount) revert InvalidBinding();
        uint256 nativeBefore = address(this).balance - amount;
        uint256 wrappedBefore = asset.balanceOf(address(this));
        IWrappedNative(asset).deposit{value: amount}();
        if (asset.balanceOf(address(this)) - wrappedBefore != amount || address(this).balance != nativeBefore) revert InvalidAmount();
        l.amount += amount;
        emit ToppedUp(lockId, payer, amount);
    }

    function release(bytes32 lockId, address recipient, uint256 amount, uint256 nonce) external nonReentrant {
        _onlyCore();
        bytes32 key = keccak256(abi.encode(lockId, recipient, amount, nonce));
        if (releaseUsed[key]) revert Used();
        Lock storage l = locks[lockId];
        if (!lockExists[lockId]) revert Unknown();
        if (l.released || l.seized) revert Used();
        if (recipient != l.recipient || amount == 0 || amount > l.amount) revert InvalidBinding();
        l.amount -= amount;
        if (l.amount == 0) l.released = true;
        releaseUsed[key] = true;

        uint256 wrappedBefore = asset.balanceOf(address(this));
        uint256 nativeBefore = address(this).balance;
        unwrapping = true;
        IWrappedNative(asset).withdraw(amount);
        unwrapping = false;
        if (wrappedBefore - asset.balanceOf(address(this)) != amount || address(this).balance - nativeBefore != amount)
        {
            revert InvalidAmount();
        }
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
        emit Released(lockId, recipient, amount);
    }

    function seize(bytes32 lockId, address recipient, uint256 amount) external nonReentrant {
        _onlyCore();
        Lock storage l = locks[lockId];
        if (!lockExists[lockId]) revert Unknown();
        if (l.released || l.seized || recipient == address(0) || amount == 0 || amount > l.amount) {
            revert InvalidBinding();
        }
        l.amount -= amount;
        if (l.amount == 0) l.seized = true;
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert InvalidAmount();
        emit Seized(lockId, recipient, amount);
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

    function _onlyCore() private view {
        _checkChain();
        if (msg.sender != core) revert Unauthorized();
    }

    function _checkChain() private view {
        if (block.chainid != chainId_) revert InvalidChain();
    }
}
