// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Events} from "../../shared/Events.sol";
import {ISettlementInbox} from "./ISettlementInbox.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {AuthLib} from "../../shared/AuthLib.sol";

interface ISettlementReceiver {
    function onSettlement(bytes32 operationId, bytes32 creditId, address token, uint256 amount) external;
}

interface ISettlementDebt {
    function core() external view returns (address);
}

interface ICreditDebt {
    function creditDebt(bytes32 creditId) external view returns (uint256);
}

contract SettlementInbox is ISettlementInbox {
    using SafeTransferLib for address;

    bytes32 public immutable operationId;
    address public immutable vault;
    address public immutable token;
    bytes32 public immutable creditId;
    uint256 public minOut;
    uint256 public immutable maxReceived;
    address public immutable refundRecipient;
    uint256 public deadline;
    address public immutable factory;
    address public lpAuthorizer;
    uint256 public lpMinShares;
    uint256 public lpMaxDeposit;
    uint256 public lpRevision = 1;
    uint256 public received;
    uint256 public applied;
    uint256 public refunded;
    uint256 public untrackedApplied;
    uint256 public untrackedRefunded;
    bool public cancelled;
    bool public boundedRepayment;
    bool private entered;

    error Reentered();
    error Nothing();
    error Expired();
    error BadToken();
    error InvalidRecipient();
    error DeliveryMismatch();
    error CapExceeded();
    error ReceiverFailed();

    event UntrackedRefunded(bytes32 indexed operationId, uint256 amount);
    event UntrackedSettled(bytes32 indexed operationId, uint256 amount);
    event LpAuthorizationRevised(bytes32 indexed operationId, uint256 revision);
    event Cancelled(bytes32 indexed operationId);

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
        factory = msg.sender;
        lpAuthorizer = refundRecipient_;
        lpMaxDeposit = maxReceived_;
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

    function configureRepayment() external {
        if (msg.sender != factory || creditId == bytes32(0) || received != 0 || boundedRepayment) revert InvalidRecipient();
        boundedRepayment = true;
    }

    function configureLp(address authorizer, uint256 minShares) external {
        if (msg.sender != factory || creditId != bytes32(0) || authorizer == address(0)
            || minShares == 0 || lpMinShares != 0 || applied != 0 || refunded != 0 || cancelled) revert InvalidRecipient();
        lpAuthorizer = authorizer;
        lpMinShares = minShares;
    }

    function reviseLp(uint256 minimum, uint256 maximum, uint256 minShares, uint256 newDeadline,
        uint256 revision, uint256 authorizationDeadline, bytes calldata signature) external guard {
        if (creditId != bytes32(0) || cancelled || applied != 0 || refunded != 0 || lpMinShares == 0
            || minimum > maximum || maximum == 0 || maximum > maxReceived || minShares == 0
            || newDeadline <= block.timestamp || block.timestamp > authorizationDeadline
            || revision != lpRevision + 1) revert InvalidRecipient();
        bytes32 digest = lpRevisionDigest(minimum, maximum, minShares, newDeadline, revision, authorizationDeadline);
        if (msg.sender != lpAuthorizer && !AuthLib.verify(digest, signature, lpAuthorizer)) revert InvalidRecipient();
        minOut = minimum;
        lpMaxDeposit = maximum;
        lpMinShares = minShares;
        deadline = newDeadline;
        lpRevision = revision;
        emit LpAuthorizationRevised(operationId, revision);
    }

    function lpRevisionDigest(uint256 minimum, uint256 maximum, uint256 minShares, uint256 newDeadline,
        uint256 revision, uint256 authorizationDeadline) public view returns (bytes32) {
        return AuthLib.typedDigest(AuthLib.domainSeparator(), keccak256(abi.encode(
            keccak256("LpRevision(bytes32 operationId,uint256 minimum,uint256 maximum,uint256 minShares,uint256 deadline,uint256 revision,uint256 authorizationDeadline)"),
            operationId, minimum, maximum, minShares, newDeadline, revision, authorizationDeadline
        )));
    }

    function cancel() external guard {
        if (creditId != bytes32(0)) revert InvalidRecipient();
        if (msg.sender != lpAuthorizer || applied != 0 || cancelled) revert InvalidRecipient();
        cancelled = true;
        emit Cancelled(operationId);
    }

    function settle(uint256 amount) external guard {
        if (cancelled || (creditId == bytes32(0) && block.timestamp > deadline)) revert Expired();
        if (amount == 0 || amount > available()) revert Nothing();
        if (creditId == bytes32(0)
            && (applied != 0 || refunded != 0 || amount != available() || amount < minOut || amount > lpMaxDeposit)) {
            revert Nothing();
        }
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
        if (!cancelled && block.timestamp <= deadline && !(creditId == bytes32(0) && (applied != 0 || refunded != 0))) {
            revert Expired();
        }
        if (amount == 0 || amount > available()) revert Nothing();
        if (creditId != bytes32(0) && ICreditDebt(ISettlementDebt(vault).core()).creditDebt(creditId) != 0) {
            revert Nothing();
        }
        refunded += amount;
        uint256 recipientBalance = _balanceOf(refundRecipient);
        token.safeTransfer(refundRecipient, amount);
        if (_balanceOf(refundRecipient) - recipientBalance != amount) revert BadToken();
        emit Events.InboxRefunded(operationId, amount);
    }

    function refundUntracked(uint256 amount) external guard {
        if (block.timestamp <= deadline && !(creditId == bytes32(0) && (cancelled || applied != 0 || refunded != 0))) {
            revert Expired();
        }
        if (!boundedRepayment && creditId != bytes32(0) && ICreditDebt(ISettlementDebt(vault).core()).creditDebt(creditId) != 0) {
            revert Nothing();
        }
        uint256 balance = _balance();
        uint256 outstanding = available();
        if (amount == 0 || balance < outstanding || amount > balance - outstanding) revert Nothing();
        untrackedRefunded += amount;
        uint256 recipientBalance = _balanceOf(refundRecipient);
        token.safeTransfer(refundRecipient, amount);
        if (_balanceOf(refundRecipient) - recipientBalance != amount) revert BadToken();
        emit UntrackedRefunded(operationId, amount);
    }

    function settleUntracked(uint256 amount) external guard {
        if (creditId == bytes32(0) || boundedRepayment) revert Nothing();
        uint256 debt = ICreditDebt(ISettlementDebt(vault).core()).creditDebt(creditId);
        uint256 balance = _balance();
        uint256 outstanding = available();
        if (amount == 0 || amount > debt || balance < outstanding || amount > balance - outstanding) revert Nothing();
        untrackedApplied += amount;
        uint256 vaultBalance = _balanceOf(vault);
        token.safeTransfer(vault, amount);
        if (_balanceOf(vault) - vaultBalance != amount) revert BadToken();
        try ISettlementReceiver(vault).onSettlement(operationId, creditId, token, amount) {} catch {
            revert ReceiverFailed();
        }
        emit UntrackedSettled(operationId, amount);
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
