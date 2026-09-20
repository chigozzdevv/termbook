// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Events} from "../shared/Events.sol";
import {ISettlementInbox} from "./ISettlementInbox.sol";
import {SafeTransferLib} from "../shared/SafeTransferLib.sol";

interface ISettlementReceiver {
    function onSettlement(bytes32 operationId, bytes32 creditId, address token, uint256 amount) external;
}

contract SettlementInbox is ISettlementInbox {
    using SafeTransferLib for address;

    bytes32 public immutable operationId;
    address public immutable vault;
    address public immutable token;
    bytes32 public immutable creditId;
    uint256 public immutable minOut;
    uint256 public immutable maxReceived;
    address public immutable refundRecipient;
    uint256 public immutable deadline;
    uint256 public received;
    uint256 public applied;
    uint256 public refunded;
    bool public cancelled;
    bool private entered;

    error Reentered();
    error Nothing();
    error Expired();
    error BadToken();
    error InvalidRecipient();
    error DeliveryMismatch();
    error CapExceeded();
    error ReceiverFailed();

    constructor(
        bytes32 operationId_,
        address vault_,
        address token_,
        bytes32 creditId_,
        uint256 minOut_,
        uint256 maxReceived_,
        address refundRecipient_,
        uint256 deadline_
    ) {
        if (
            operationId_ == bytes32(0) || vault_.code.length == 0 || token_.code.length == 0
                || refundRecipient_ == address(0) || maxReceived_ == 0 || minOut_ > maxReceived_
        ) revert BadToken();
        operationId = operationId_;
        vault = vault_;
        token = token_;
        creditId = creditId_;
        minOut = minOut_;
        maxReceived = maxReceived_;
        refundRecipient = refundRecipient_;
        deadline = deadline_;
    }

    modifier guard() {
        if (entered) revert Reentered();
        entered = true;
        _;
        entered = false;
    }

    function available() public view returns (uint256) {
        return received - applied - refunded;
    }

    function notifyReceipt(uint256 amount) external {
        if (amount == 0) revert Nothing();
        if (amount > maxReceived - received) revert CapExceeded();
        uint256 balance = _balance();
        if (balance < available() + amount) revert DeliveryMismatch();
        received += amount;
    }

    function notifyAll() external returns (uint256 amount) {
        uint256 balance = _balance();
        uint256 outstanding = available();
        if (balance <= outstanding) revert Nothing();
        amount = balance - outstanding;
        if (amount > maxReceived - received) revert CapExceeded();
        received += amount;
    }

    function cancel() external {
        if (msg.sender != vault && msg.sender != refundRecipient) revert InvalidRecipient();
        if (block.timestamp > deadline) revert Expired();
        if (available() != 0) revert Nothing();
        cancelled = true;
    }

    function settle(uint256 amount) external guard {
        if (cancelled || (creditId == bytes32(0) && block.timestamp > deadline)) revert Expired();
        if (amount == 0 || amount > available() || (received < minOut && block.timestamp <= deadline)) revert Nothing();
        applied += amount;
        uint256 vaultBalance = _balanceOf(vault);
        token.safeTransfer(vault, amount);
        if (_balanceOf(vault) - vaultBalance != amount) revert BadToken();
        try ISettlementReceiver(vault).onSettlement(operationId, creditId, token, amount) {} catch {
            revert ReceiverFailed();
        }
        emit Events.InboxSettled(operationId, amount);
    }

    function refund(uint256 amount) external guard {
        if (!cancelled && block.timestamp <= deadline) revert Expired();
        if (amount == 0 || amount > available()) revert Nothing();
        refunded += amount;
        uint256 recipientBalance = _balanceOf(refundRecipient);
        token.safeTransfer(refundRecipient, amount);
        if (_balanceOf(refundRecipient) - recipientBalance != amount) revert BadToken();
        emit Events.InboxRefunded(operationId, amount);
    }

    function _balance() internal view returns (uint256 value) {
        return _balanceOf(address(this));
    }

    function _balanceOf(address account) internal view returns (uint256 value) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        if (!ok || data.length < 32) revert BadToken();
        value = abi.decode(data, (uint256));
    }
}
