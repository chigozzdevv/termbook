// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuthLib} from "../shared/AuthLib.sol";
import {SafeTransferLib} from "../shared/SafeTransferLib.sol";

contract SourceRecoveryVault {
    using SafeTransferLib for address;

    struct Funding {
        bytes32 creditId;
        bytes32 operationId;
        address inbox;
        address depositAddress;
        uint256 amount;
        bytes32 quoteHash;
        uint256 nonce;
        uint256 deadline;
    }

    struct InFlight {
        bytes32 creditId;
        uint256 amount;
    }

    bytes32 public constant FUNDING_TYPEHASH = keccak256(
        "RecoveryFunding(bytes32 creditId,bytes32 operationId,address inbox,address depositAddress,uint256 amount,bytes32 quoteHash,uint256 nonce,uint256 deadline,uint256 monadChain,address asset)"
    );
    bytes32 public constant REFUND_TYPEHASH = keccak256(
        "RecoveryRefund(bytes32 operationId,bytes32 refundTxHash,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    address public immutable asset;
    address public immutable governance;
    address public immutable routeSigner;
    uint256 public immutable monadChain;
    address public controller;
    uint256 public totalHeld;
    mapping(bytes32 => uint256) public held;
    mapping(bytes32 => InFlight) public inFlight;
    mapping(bytes32 => bool) public usedOperation;
    mapping(bytes32 => bool) public usedRefund;

    error Invalid();
    error Unauthorized();
    event ControllerSet(address indexed controller);
    event SeizureRecorded(bytes32 indexed creditId, uint256 amount);
    event RouteFunded(bytes32 indexed creditId, bytes32 indexed operationId, address inbox, uint256 amount);
    event SourceRefundRecorded(bytes32 indexed creditId, bytes32 indexed operationId, uint256 amount);

    constructor(address asset_, uint256 monadChain_, address governance_, address routeSigner_) {
        if (asset_.code.length == 0 || monadChain_ == 0 || governance_ == address(0) || routeSigner_ == address(0)) {
            revert Invalid();
        }
        asset = asset_;
        monadChain = monadChain_;
        governance = governance_;
        routeSigner = routeSigner_;
    }

    function setController(address controller_) external {
        if (msg.sender != governance || controller != address(0) || controller_.code.length == 0) revert Unauthorized();
        controller = controller_;
        emit ControllerSet(controller_);
    }

    function recordSeizure(bytes32 creditId, uint256 amount) external {
        if (msg.sender != controller) revert Unauthorized();
        if (creditId == bytes32(0) || amount == 0 || asset.balanceOf(address(this)) < totalHeld + amount) revert Invalid();
        held[creditId] += amount;
        totalHeld += amount;
        emit SeizureRecorded(creditId, amount);
    }

    function fundingDigest(Funding calldata funding) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            FUNDING_TYPEHASH, funding.creditId, funding.operationId, funding.inbox,
            funding.depositAddress, funding.amount, funding.quoteHash, funding.nonce,
            funding.deadline, monadChain, asset
        ));
        return AuthLib.typedDigest(AuthLib.domainSeparator(), structHash);
    }

    function fund(Funding calldata funding, bytes calldata signature) external {
        if (
            funding.creditId == bytes32(0) || funding.operationId == bytes32(0) || funding.inbox == address(0)
                || funding.depositAddress == address(0) || funding.quoteHash == bytes32(0)
                || funding.amount == 0 || funding.amount > held[funding.creditId]
                || funding.deadline < block.timestamp || usedOperation[funding.operationId]
                || !AuthLib.verify(fundingDigest(funding), signature, routeSigner)
        ) revert Invalid();
        usedOperation[funding.operationId] = true;
        held[funding.creditId] -= funding.amount;
        totalHeld -= funding.amount;
        inFlight[funding.operationId] = InFlight(funding.creditId, funding.amount);
        uint256 beforeBalance = asset.balanceOf(funding.depositAddress);
        asset.safeTransfer(funding.depositAddress, funding.amount);
        if (asset.balanceOf(funding.depositAddress) - beforeBalance != funding.amount) revert Invalid();
        emit RouteFunded(funding.creditId, funding.operationId, funding.inbox, funding.amount);
    }

    function refundDigest(bytes32 operationId, bytes32 refundTxHash, uint256 amount, uint256 nonce, uint256 deadline)
        public view returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(REFUND_TYPEHASH, operationId, refundTxHash, amount, nonce, deadline));
        return AuthLib.typedDigest(AuthLib.domainSeparator(), structHash);
    }

    function recordSourceRefund(
        bytes32 operationId,
        bytes32 refundTxHash,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        InFlight storage operation = inFlight[operationId];
        bytes32 refundId = keccak256(abi.encode(operationId, refundTxHash, amount, nonce));
        bytes32 digest = refundDigest(operationId, refundTxHash, amount, nonce, deadline);
        if (
            operation.creditId == bytes32(0) || refundTxHash == bytes32(0) || amount == 0
                || amount > operation.amount || deadline < block.timestamp || usedRefund[refundId]
                || !AuthLib.verify(digest, signature, routeSigner)
                || asset.balanceOf(address(this)) < totalHeld + amount
        ) revert Invalid();
        usedRefund[refundId] = true;
        operation.amount -= amount;
        held[operation.creditId] += amount;
        totalHeld += amount;
        emit SourceRefundRecorded(operation.creditId, operationId, amount);
    }
}
