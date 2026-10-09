// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICreditAccount} from "./ICreditAccount.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {ExecutionTypes} from "../integration/IExecutionPolicy.sol";
import {IntegrationRegistry} from "../integration/IntegrationRegistry.sol";
import {PriceProtection} from "../integration/PriceProtection.sol";

interface IERC20Account {
    function balanceOf(address account) external view returns (uint256);
}

contract CreditAccount is ICreditAccount {
    using SafeTransferLib for address;

    bytes32 public immutable creditId;
    address public immutable borrower;
    address public immutable core;
    mapping(address => mapping(address => uint256)) public allowances;
    uint256 public activeAllowances;
    bool public released;
    event ControlReleased(address indexed borrower);

    error Unauthorized();
    error BadTarget();
    error InvalidTarget();
    error CallFailed();
    error InvalidToken();
    error OverLimit();

    constructor(bytes32 creditId_, address borrower_, address core_) {
        if (creditId_ == bytes32(0) || borrower_ == address(0) || core_ == address(0)) revert Unauthorized();
        creditId = creditId_;
        borrower = borrower_;
        core = core_;
    }

    modifier onlyCore() {
        if (msg.sender != (released ? borrower : core)) revert Unauthorized();
        _;
    }

    receive() external payable {}

    function execute(address target, bytes calldata data) external onlyCore returns (bytes memory result) {
        return _execute(target, data, 0);
    }

    function executeWithValue(address target, bytes calldata data, uint256 value) external onlyCore returns (bytes memory) {
        return _execute(target, data, value);
    }

    function _execute(address target, bytes calldata data, uint256 value) private returns (bytes memory) {
        if (target == address(0) || target == address(this) || target.code.length == 0 || data.length < 4) revert BadTarget();
        if (value > address(this).balance) revert InvalidTarget();
        (bool ok, bytes memory out) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(out, 32), mload(out))
            }
        }
        return out;
    }

    function approveSpend(address token, address spender, uint256 amount) external onlyCore {
        _approveSpend(token, spender, amount);
    }

    function executeApprovedCalls(bytes32 bundle, ExecutionTypes.Action calldata action, address registry, PriceProtection prices)
        external onlyCore returns (bytes[] memory results) {
        results = new bytes[](action.calls.length);
        for (uint256 i; i < action.calls.length; ++i) {
            ExecutionTypes.Call calldata call_ = action.calls[i];
            if (!IntegrationRegistry(registry).validateValueCall(bundle, call_.target, call_.data, address(this),
                call_.spendAmount, call_.nativeValue)) revert Unauthorized();
            if (call_.spendAmount != 0) {
                if (call_.spendAmount > call_.spendToken.balanceOf(address(this))) revert OverLimit();
                _approveSpend(call_.spendToken, call_.target, 0);
                _approveSpend(call_.spendToken, call_.target, call_.spendAmount);
            }
            (uint256 beforeInput, uint256 beforeOutput) = prices.captureBalances(bundle, action, address(this), i);
            results[i] = _execute(call_.target, call_.data, call_.nativeValue);
            prices.validateAmountResult(bundle, action, address(this), i, beforeInput, beforeOutput);
            if (call_.spendAmount != 0) _approveSpend(call_.spendToken, call_.target, 0);
        }
    }

    function executeRecoveryCall(bytes32 bundle, address token, uint256 amount, address target, bytes calldata data,
        uint256 nativeValue, address registry) external onlyCore returns (bytes memory result) {
        if (!IntegrationRegistry(registry).validateRecoveryValueCall(bundle, target, data, address(this), nativeValue)) revert Unauthorized();
        uint256 beforeBalance;
        if (amount != 0) {
            if (token == target || !IntegrationRegistry(registry).dependencyValid(bundle, token)) revert InvalidToken();
            beforeBalance = token.balanceOf(address(this));
            if (amount > beforeBalance) revert OverLimit();
            _approveSpend(token, target, 0);
            _approveSpend(token, target, amount);
        }
        result = _execute(target, data, nativeValue);
        if (amount != 0) {
            _approveSpend(token, target, 0);
            uint256 afterBalance = token.balanceOf(address(this));
            if (beforeBalance > afterBalance && beforeBalance - afterBalance > amount) revert OverLimit();
        }
    }

    function _approveSpend(address token, address spender, uint256 amount) private {
        if (token.code.length == 0 || spender == address(0)) revert InvalidToken();
        uint256 previous = allowances[token][spender];
        if (previous == 0 && amount != 0) activeAllowances += 1;
        if (previous != 0 && amount == 0) activeAllowances -= 1;
        token.safeApprove(spender, amount);
        allowances[token][spender] = amount;
    }

    function transferNative(address payable to, uint256 amount) external onlyCore {
        if (to == address(0) || amount > address(this).balance) revert InvalidTarget();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert CallFailed();
    }

    function transferToken(address token, address to, uint256 amount) external onlyCore {
        if (token.code.length == 0 || to == address(0)) revert InvalidTarget();
        uint256 beforeBalance = IERC20Account(token).balanceOf(to);
        token.safeTransfer(to, amount);
        if (IERC20Account(token).balanceOf(to) - beforeBalance != amount) revert InvalidToken();
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20Account(token).balanceOf(address(this));
    }

    function releaseControl() external {
        if (msg.sender != core || released || activeAllowances != 0) revert Unauthorized();
        released = true;
        emit ControlReleased(borrower);
    }
}
