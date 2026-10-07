// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeTransferLib} from "../../src/shared/SafeTransferLib.sol";
import {IAppStateReader} from "../../src/monad/integration/IAppStateReader.sol";
import {IAppCashReader} from "../../src/monad/integration/IAppCashReader.sol";
import {IAppValueReader} from "../../src/monad/integration/IAppValueReader.sol";
import {IAppRecoveryAdapter} from "../../src/monad/integration/IAppRecoveryAdapter.sol";
import {IAppExitPlanner} from "../../src/monad/integration/IAppExitPlanner.sol";
import {IExecutionPolicy, ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";

interface IReferenceCore { function creditAccount(bytes32) external view returns (address); }

// Live test application with fully redeemable settlement-token positions.
contract ReferenceAssetApp is IAppStateReader, IAppCashReader, IAppValueReader,
    IAppRecoveryAdapter, IAppExitPlanner, IExecutionPolicy {
    using SafeTransferLib for address;
    address public immutable token;
    IReferenceCore public immutable core;
    bytes32 public constant MARKET = keccak256("Termbook reference USDC position");
    bytes32 public constant DEPOSIT = keccak256("deposit");
    bytes32 public constant WITHDRAW = keccak256("withdraw");
    mapping(address => uint256) public positions;
    uint256 public liabilities;
    bool private entered;
    error Invalid();
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    constructor(address core_, address token_) {
        if (core_.code.length == 0 || token_.code.length == 0) revert Invalid();
        core = IReferenceCore(core_);
        token = token_;
    }

    modifier guarded() { if (entered) revert Invalid(); entered = true; _; entered = false; }

    function deposit(uint256 amount) external guarded {
        if (amount == 0) revert Invalid();
        uint256 balance = token.balanceOf(address(this));
        if (balance < liabilities) revert Invalid();
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balance != amount) revert Invalid();
        positions[msg.sender] += amount;
        liabilities += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external guarded {
        if (amount == 0 || amount > positions[msg.sender] || token.balanceOf(address(this)) < liabilities) revert Invalid();
        positions[msg.sender] -= amount;
        liabilities -= amount;
        uint256 beforeBalance = token.balanceOf(msg.sender);
        token.safeTransfer(msg.sender, amount);
        if (token.balanceOf(msg.sender) - beforeBalance != amount) revert Invalid();
        emit Withdrawn(msg.sender, amount);
    }

    function _check(bytes32 creditId, address account) private view {
        if (account == address(0) || core.creditAccount(creditId) != account
            || token.balanceOf(address(this)) < liabilities) revert Invalid();
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IAppStateReader).interfaceId || id == type(IAppCashReader).interfaceId;
    }
    function positionCount(bytes32 creditId, address account) external view returns (uint256) {
        _check(creditId, account);
        return positions[account] == 0 ? 0 : 1;
    }
    function positionAt(bytes32 creditId, address account, uint256 index) external view returns (bytes32, bytes32) {
        _check(creditId, account);
        if (index != 0 || positions[account] == 0) revert Invalid();
        return (keccak256(abi.encode(MARKET, account)), MARKET);
    }
    function pendingCount(bytes32 creditId, address account) external view returns (uint256) {
        _check(creditId, account);
        return 0;
    }
    function pendingAt(bytes32, address, uint256) external pure returns (bytes32, bytes32, uint256, uint256) { revert Invalid(); }
    function reservedCash(bytes32 creditId, address account, address settlement) external view returns (uint256, uint256) {
        _check(creditId, account);
        if (settlement != token) revert Invalid();
        return (0, block.timestamp);
    }
    function readAppValue(bytes32 creditId, address account, address settlement) external view returns (int256, uint16, uint128, uint256) {
        _check(creditId, account);
        if (settlement != token || positions[account] > uint256(type(int256).max)) revert Invalid();
        return (int256(positions[account]), 10_000, 0, block.timestamp);
    }
    function recoveryCall(bytes32 creditId, address account, bytes calldata instruction) external view returns (address, bytes memory, uint256, bytes32) {
        _check(creditId, account);
        if (instruction.length != 32) revert Invalid();
        uint256 amount = abi.decode(instruction, (uint256));
        if (amount == 0 || amount > positions[account]) revert Invalid();
        return (address(this), abi.encodeWithSelector(this.withdraw.selector, amount), 0,
            keccak256(abi.encode(positions[account] - amount, token.balanceOf(account) + amount)));
    }
    function verifyRecovery(bytes32 creditId, address account, bytes calldata, bytes32 expected) external view returns (bool) {
        _check(creditId, account);
        return expected == keccak256(abi.encode(positions[account], token.balanceOf(account)));
    }
    function nextExitStep(bytes32 creditId, address account) external view returns (bytes32, bytes memory, uint256) {
        _check(creditId, account);
        uint256 amount = positions[account];
        if (amount == 0) return (bytes32(0), "", 0);
        return (keccak256(abi.encode(creditId, account, amount)), abi.encode(amount), 0);
    }
    function stateReader() external view returns (address) { return address(this); }
    function _action(ExecutionTypes.Action calldata action) private view returns (bool depositing, uint256 amount) {
        if (action.market != MARKET || action.calls.length != 1) revert Invalid();
        ExecutionTypes.Call calldata call_ = action.calls[0];
        if (call_.target != address(this) || call_.data.length != 36) revert Invalid();
        bytes4 selector = bytes4(call_.data[:4]);
        amount = abi.decode(call_.data[4:], (uint256));
        if (amount == 0) revert Invalid();
        depositing = action.capability == DEPOSIT && selector == this.deposit.selector;
        if (depositing) {
            if (call_.spendToken != token || call_.spendAmount != amount || action.requiredInput != amount) revert Invalid();
        } else if (action.capability != WITHDRAW || selector != this.withdraw.selector
            || call_.spendToken != address(0) || call_.spendAmount != 0 || action.requiredInput != 0) revert Invalid();
    }
    function prepare(bytes32 creditId, address account, ExecutionTypes.Action calldata action) external view returns (bytes32, uint8, uint8, uint256) {
        _check(creditId, account);
        (bool depositing, uint256 amount) = _action(action);
        if (!depositing && amount > positions[account]) revert Invalid();
        return (bytes32(positions[account]), depositing && positions[account] == 0 ? 1 : 0, 0,
            depositing ? positions[account] + amount : positions[account] - amount);
    }
    function verifyResult(bytes32 creditId, address account, ExecutionTypes.Action calldata action, bytes32 beforeState, bytes[] calldata results)
        external view returns (bytes32[] memory) {
        _check(creditId, account);
        (bool depositing, uint256 amount) = _action(action);
        uint256 previous = uint256(beforeState);
        if (results.length != 1 || results[0].length != 0
            || !depositing && amount > previous
            || positions[account] != (depositing ? previous + amount : previous - amount)) revert Invalid();
        return new bytes32[](0);
    }
    function pendingState(bytes32, address, bytes32) external pure returns (ExecutionTypes.PendingState memory) { revert Invalid(); }
}
