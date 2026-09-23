// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SettlementInbox} from "./SettlementInbox.sol";
import {AuthLib} from "../shared/AuthLib.sol";

interface IRouteAdmission {
    function routes(bytes32 id) external view returns (address, bytes32, bool, uint256, uint256);
}

interface IHouseInboxRegistration {
    function asset() external view returns (address);
    function core() external view returns (address);
    function registerInboxFromFactory(address inbox, uint8 kind, address lpRecipient, uint256 minShares) external;
}

interface IRouteCreditCore {
    function creditVault(bytes32 creditId) external view returns (address);
    function creditDebt(bytes32 creditId) external view returns (uint256);
    function creditFacility(bytes32 creditId) external view returns (uint8);
    function remoteCollateral(bytes32 creditId) external view returns (bool);
    function recoveryKeepers(address keeper) external view returns (bool);
    function recoveryRefundRecipientOf(bytes32 creditId) external view returns (address);
    function minimumRemoteRecoveryProceeds(bytes32 creditId, uint256 collateralAmount)
        external view returns (uint256);
    function remoteRecoveryContext(bytes32 creditId)
        external
        view
        returns (uint256 sourceChain, address sourceAsset, address recoveryVault);
}

contract InboxFactory {
    address public immutable governance;
    address public registrar;
    address public routeRegistry;
    mapping(bytes32 => address) public inboxOf;
    mapping(bytes32 => bytes32) public operationDigestOf;
    bytes32 public constant OPERATION_TYPEHASH = keccak256(
        "SettlementOperation(bytes32 operationId,uint8 kind,address payer,uint256 sourceChain,address sourceAsset,address vault,address token,bytes32 creditId,uint256 maxAmountIn,uint256 minOut,uint256 maxReceived,address sourceRefund,address refundRecipient,uint256 deadline,bytes32 routeId,bytes32 routeVersion,address lpRecipient,uint256 minShares)"
    );
    struct Operation {
        bytes32 operationId;
        uint8 kind;
        address payer;
        uint256 sourceChain;
        address sourceAsset;
        address vault;
        address token;
        bytes32 creditId;
        uint256 maxAmountIn;
        uint256 minOut;
        uint256 maxReceived;
        address sourceRefund;
        address refundRecipient;
        uint256 deadline;
        bytes32 routeId;
        bytes32 routeVersion;
        address lpRecipient;
        uint256 minShares;
    }
    error Unauthorized();
    error Replay();
    error Invalid();

    event InboxCreated(bytes32 indexed operationId, address inbox);
    event RecoveryOperationCreated(bytes32 indexed operationId, bytes32 indexed operationDigest, address indexed inbox);
    event RegistrarSet(address indexed registrar);
    event RouteRegistrySet(address indexed registry);

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
        registrar = governance_;
    }

    function setRegistrar(address registrar_) external {
        if (msg.sender != governance || registrar_ == address(0)) revert Unauthorized();
        registrar = registrar_;
        emit RegistrarSet(registrar_);
    }

    function setRouteRegistry(address registry) external {
        if (msg.sender != governance || registry.code.length == 0) revert Unauthorized();
        routeRegistry = registry;
        emit RouteRegistrySet(registry);
    }

    function operationDigest(Operation calldata op) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            OPERATION_TYPEHASH, op.operationId, op.kind, op.payer, op.sourceChain, op.sourceAsset,
            op.vault, op.token, op.creditId, op.maxAmountIn, op.minOut, op.maxReceived,
            op.sourceRefund, op.refundRecipient, op.deadline, op.routeId, op.routeVersion,
            op.lpRecipient, op.minShares
        ));
        return AuthLib.typedDigest(AuthLib.domainSeparator(), structHash);
    }

    function createAuthorized(Operation calldata op, bytes calldata signature) external returns (address inbox) {
        if (
            routeRegistry == address(0) || op.operationId == bytes32(0) || inboxOf[op.operationId] != address(0)
                || op.payer == address(0) || op.sourceChain == 0 || op.sourceAsset == address(0)
                || op.sourceRefund == address(0) || op.refundRecipient == address(0)
                || op.vault.code.length == 0 || op.token.code.length == 0
                || op.maxAmountIn == 0 || op.maxReceived == 0 || op.minOut > op.maxReceived
                || op.deadline <= block.timestamp || op.kind > 2
        ) revert Invalid();
        if (op.kind == 2) {
            if (op.creditId != bytes32(0) || op.lpRecipient == address(0) || op.minShares == 0) revert Invalid();
        } else if (op.creditId == bytes32(0) || op.lpRecipient != address(0) || op.minShares != 0) {
            revert Invalid();
        }
        if (IHouseInboxRegistration(op.vault).asset() != op.token) revert Invalid();
        if (op.kind != 2) {
            IRouteCreditCore core = IRouteCreditCore(IHouseInboxRegistration(op.vault).core());
            if (core.creditVault(op.creditId) != op.vault || core.creditDebt(op.creditId) == 0) revert Invalid();
            if (op.kind == 1) {
                uint8 facility = core.creditFacility(op.creditId);
                (uint256 sourceChain, address sourceAsset, address recoveryVault) =
                    core.remoteRecoveryContext(op.creditId);
                if (
                    !core.remoteCollateral(op.creditId) || !core.recoveryKeepers(op.payer)
                        || (facility != 8 && facility != 9 && facility != 10)
                        || sourceChain != op.sourceChain || sourceAsset != op.sourceAsset
                        || recoveryVault != op.sourceRefund
                        || core.recoveryRefundRecipientOf(op.creditId) != op.refundRecipient
                        || op.minOut < core.minimumRemoteRecoveryProceeds(op.creditId, op.maxAmountIn)
                ) revert Invalid();
            }
        }
        (address adapter, bytes32 pair, bool active, uint256 maximum, uint256 version) =
            IRouteAdmission(routeRegistry).routes(op.routeId);
        if (
            !active || adapter.code.length == 0 || op.maxAmountIn > maximum
                || op.routeVersion != bytes32(version)
                || pair != keccak256(abi.encode(op.sourceChain, op.sourceAsset, block.chainid, op.token))
                || !AuthLib.verify(operationDigest(op), signature, op.payer)
        ) revert Invalid();
        inbox = address(new SettlementInbox(
            op.operationId, op.vault, op.token, op.creditId, op.minOut,
            op.maxReceived, op.refundRecipient, op.deadline
        ));
        inboxOf[op.operationId] = inbox;
        bytes32 digest = operationDigest(op);
        operationDigestOf[op.operationId] = digest;
        IHouseInboxRegistration(op.vault).registerInboxFromFactory(inbox, op.kind, op.lpRecipient, op.minShares);
        emit InboxCreated(op.operationId, inbox);
        if (op.kind == 1) emit RecoveryOperationCreated(op.operationId, digest, inbox);
    }

    function create(
        bytes32 operationId,
        address vault,
        address token,
        bytes32 creditId,
        uint256 minOut,
        uint256 maxReceived,
        address refundRecipient,
        uint256 deadline
    ) external returns (address inbox) {
        if (msg.sender != registrar) revert Unauthorized();
        if (inboxOf[operationId] != address(0)) revert Replay();
        if (
            operationId == bytes32(0) || vault.code.length == 0 || token.code.length == 0
                || refundRecipient == address(0) || maxReceived == 0 || minOut > maxReceived
        ) revert Invalid();
        inbox = address(new SettlementInbox(operationId, vault, token, creditId, minOut, maxReceived, refundRecipient, deadline));
        inboxOf[operationId] = inbox;
        emit InboxCreated(operationId, inbox);
    }
}
