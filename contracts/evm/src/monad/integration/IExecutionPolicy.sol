// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library ExecutionTypes {
    struct Call { address target; address spendToken; uint256 spendAmount; bytes data; }
    struct Action {
        bytes32 capability;
        bytes32 market;
        Call[] calls;
        uint256 requiredInput;
        uint256 exposureLimit;
    }
    enum Status { None, Pending, CancelRequested, Settled, Cancelled, Failed, Expired }
    struct PendingState {
        bytes32 positionId;
        uint256 committed;
        uint256 filled;
        uint256 refunded;
        uint256 remaining;
        uint256 liability;
        uint256 maxLiability;
        uint256 deadline;
        uint256 observedAt;
        uint8 positionSlots;
        address refundRecipient;
        Status status;
    }
}

interface IExecutionPolicy {
    function stateReader() external view returns (address);
    function prepare(bytes32 creditId, address account, ExecutionTypes.Action calldata action)
        external view returns (bytes32 beforeState, uint8 positionSlots, uint8 pendingSlots, uint256 exposure);
    function verifyResult(bytes32 creditId, address account, ExecutionTypes.Action calldata action,
        bytes32 beforeState, bytes[] calldata results) external view returns (bytes32[] memory pendingIds);
    function pendingState(bytes32 creditId, address account, bytes32 pendingId)
        external view returns (ExecutionTypes.PendingState memory);
}
