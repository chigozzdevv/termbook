// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICreditAccount} from "./ICreditAccount.sol";
import {SafeTransferLib} from "../shared/SafeTransferLib.sol";

interface IERC20Account {
    function balanceOf(address account) external view returns (uint256);
}

contract CreditAccount is ICreditAccount {
    using SafeTransferLib for address;

    bytes32 public immutable creditId;
    address public immutable borrower;
    address public immutable core;
    mapping(address => mapping(address => uint256)) public allowances;

    error Unauthorized();
    error BadTarget();
    error InvalidTarget();
    error CallFailed();
    error InvalidToken();

    constructor(bytes32 creditId_, address borrower_, address core_) {
        if (creditId_ == bytes32(0) || borrower_ == address(0) || core_ == address(0)) revert Unauthorized();
        creditId = creditId_;
        borrower = borrower_;
        core = core_;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert Unauthorized();
        _;
    }

    receive() external payable {}

    function execute(address target, bytes calldata data) external onlyCore returns (bytes memory result) {
        if (target == address(0) || target == address(this) || target.code.length == 0 || data.length < 4) revert BadTarget();
        (bool ok, bytes memory out) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(out, 32), mload(out))
            }
        }
        return out;
    }

    function approveSpend(address token, address spender, uint256 amount) external onlyCore {
        if (token.code.length == 0 || spender == address(0)) revert InvalidToken();
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
}
