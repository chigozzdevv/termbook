// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuthLib} from "../../shared/AuthLib.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {InboxFactory} from "../../monad/routing/InboxFactory.sol";
import {IVerifierAdmission} from "../../shared/collateral/IVerifier.sol";

interface IRecoveryOperationVerifier is IVerifierAdmission {
    function verifyRecoveryOperation(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external
        view
        returns (bool);
    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external view returns (bool);
}

interface IRemoteRecoveryControllerIdentity {
    function monadCore() external view returns (address);
    function monadChain() external view returns (uint256);
    function recoveryVault() external view returns (address);
    function paused() external view returns (bool);
}

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
    bytes32 public constant SOURCE_RECOVERY_RETURN_DOMAIN = keccak256("Termbook source recovery return v1");
    bytes32 public constant OPERATION_TYPEHASH = keccak256(
        "SettlementOperation(bytes32 operationId,uint8 kind,address payer,uint256 sourceChain,address sourceAsset,address vault,address token,bytes32 creditId,uint256 maxAmountIn,uint256 minOut,uint256 maxReceived,address sourceRefund,address refundRecipient,uint256 deadline,bytes32 routeId,bytes32 routeVersion,address lpRecipient,uint256 minShares)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Termbook");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable asset;
    address public immutable governance;
    address public immutable routeSigner;
    address public immutable riskSigner;
    uint256 public immutable monadChain;
    address public immutable monadFactory;
    IRecoveryOperationVerifier public immutable verifier;
    address public controller;
    address public pauseGuardian;
    bool public fundingPaused;
    bool public paused;
    uint256 public totalHeld;
    mapping(bytes32 => uint256) public held;
    mapping(bytes32 => InFlight) public inFlight;
    mapping(bytes32 => bool) public usedOperation;
    mapping(bytes32 => bool) public usedRefund;
    mapping(bytes32 => bool) public usedRefundTxHash;
    mapping(bytes32 => bool) public usedReturn;

    error Invalid();
    error Unauthorized();
    error Paused();
    event ControllerSet(address indexed controller);
    event PauseGuardianSet(address indexed guardian);
    event FundingPauseSet(bool paused);
    event PauseSet(bool paused);
    event SeizureRecorded(bytes32 indexed creditId, uint256 amount);
    event RouteFunded(bytes32 indexed creditId, bytes32 indexed operationId, address inbox, uint256 amount);
    event SourceRefundRecorded(bytes32 indexed creditId, bytes32 indexed operationId, uint256 amount);
    event HeldCollateralReturned(bytes32 indexed creditId, bytes32 indexed actionHash, address indexed recipient, uint256 amount);

    constructor(
        address asset_,
        uint256 monadChain_,
        address monadFactory_,
        address verifier_,
        address governance_,
        address routeSigner_,
        address riskSigner_
    ) {
        if (
            asset_.code.length == 0 || monadChain_ == 0 || monadChain_ == block.chainid
                || monadFactory_ == address(0) || verifier_.code.length == 0 || governance_ == address(0)
                || routeSigner_ == address(0) || riskSigner_ == address(0) || routeSigner_ == riskSigner_
        ) {
            revert Invalid();
        }
        (uint256 verifierChain,,) = IVerifierAdmission(verifier_).admission();
        if (verifierChain != monadChain_) revert Invalid();
        asset = asset_;
        monadChain = monadChain_;
        monadFactory = monadFactory_;
        verifier = IRecoveryOperationVerifier(verifier_);
        governance = governance_;
        routeSigner = routeSigner_;
        riskSigner = riskSigner_;
        pauseGuardian = governance_;
    }

    function setPauseGuardian(address guardian) external {
        if (msg.sender != governance || guardian == address(0)) revert Unauthorized();
        pauseGuardian = guardian;
        emit PauseGuardianSet(guardian);
    }

    function setFundingPaused(bool value) external {
        if (msg.sender != governance && (msg.sender != pauseGuardian || !value)) revert Unauthorized();
        fundingPaused = value;
        emit FundingPauseSet(value);
    }

    function setPaused(bool value) external {
        if (msg.sender != governance && (msg.sender != pauseGuardian || !value)) revert Unauthorized();
        paused = value;
        emit PauseSet(value);
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

    function operationDigest(InboxFactory.Operation calldata op) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            OPERATION_TYPEHASH, op.operationId, op.kind, op.payer, op.sourceChain, op.sourceAsset,
            op.vault, op.token, op.creditId, op.maxAmountIn, op.minOut, op.maxReceived,
            op.sourceRefund, op.refundRecipient, op.deadline, op.routeId, op.routeVersion,
            op.lpRecipient, op.minShares
        ));
        bytes32 separator = keccak256(abi.encode(
            DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, monadChain, monadFactory
        ));
        return AuthLib.typedDigest(separator, structHash);
    }

    function fund(
        Funding calldata funding,
        InboxFactory.Operation calldata op,
        bytes calldata header,
        bytes calldata proof,
        bytes calldata routeSignature,
        bytes calldata riskSignature
    ) external {
        if (paused || fundingPaused || _controllerPaused()) revert Paused();
        if (
            funding.creditId == bytes32(0) || funding.operationId == bytes32(0) || funding.inbox == address(0)
                || funding.depositAddress == address(0) || funding.quoteHash == bytes32(0)
                || funding.amount == 0 || funding.amount > held[funding.creditId]
                || funding.deadline < block.timestamp || usedOperation[funding.operationId]
                || op.kind != 1 || op.operationId != funding.operationId || op.creditId != funding.creditId
                || op.sourceChain != block.chainid || op.sourceAsset != asset || op.sourceRefund != address(this)
                || op.maxAmountIn != funding.amount || op.deadline < funding.deadline
        ) revert Invalid();
        bytes32 digest = fundingDigest(funding);
        if (
            !AuthLib.verify(digest, routeSignature, routeSigner)
                || !AuthLib.verify(digest, riskSignature, riskSigner)
                || !verifier.verifyRecoveryOperation(
                    header, proof, monadFactory,
                    keccak256(abi.encode(op.operationId, operationDigest(op), funding.inbox))
                )
        ) revert Unauthorized();
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
        bytes calldata routeSignature,
        bytes calldata riskSignature
    ) external {
        InFlight storage operation = inFlight[operationId];
        bytes32 refundId = keccak256(abi.encode(operationId, refundTxHash, amount, nonce));
        bytes32 digest = refundDigest(operationId, refundTxHash, amount, nonce, deadline);
        if (
            operation.creditId == bytes32(0) || refundTxHash == bytes32(0) || amount == 0
                || amount > operation.amount || deadline < block.timestamp || usedRefund[refundId]
                || usedRefundTxHash[refundTxHash]
                || !AuthLib.verify(digest, routeSignature, routeSigner)
                || !AuthLib.verify(digest, riskSignature, riskSigner)
                || asset.balanceOf(address(this)) < totalHeld + amount
        ) revert Invalid();
        usedRefund[refundId] = true;
        usedRefundTxHash[refundTxHash] = true;
        operation.amount -= amount;
        held[operation.creditId] += amount;
        totalHeld += amount;
        emit SourceRefundRecorded(operation.creditId, operationId, amount);
    }

    function returnHeldHash(bytes32 creditId, address recipient, uint256 amount, uint256 nonce, uint256 deadline)
        public view returns (bytes32)
    {
        address monadCore = IRemoteRecoveryControllerIdentity(controller).monadCore();
        return keccak256(abi.encode(
            SOURCE_RECOVERY_RETURN_DOMAIN, monadChain, monadCore, block.chainid, address(this),
            creditId, asset, recipient, amount, nonce, deadline
        ));
    }

    function returnHeld(
        bytes32 creditId,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata header,
        bytes calldata proof
    ) external {
        if (paused || _controllerPaused()) revert Paused();
        if (
            creditId == bytes32(0) || recipient == address(0) || amount == 0 || amount > held[creditId]
                || nonce == 0 || deadline < block.timestamp || controller == address(0)
                || IRemoteRecoveryControllerIdentity(controller).monadChain() != monadChain
                || IRemoteRecoveryControllerIdentity(controller).recoveryVault() != address(this)
        ) revert Invalid();
        address monadCore = IRemoteRecoveryControllerIdentity(controller).monadCore();
        if (monadCore == address(0)) revert Invalid();
        bytes32 actionHash = returnHeldHash(creditId, recipient, amount, nonce, deadline);
        if (
            usedReturn[actionHash]
                || !verifier.verifyEvent(
                    header, proof, monadCore, keccak256(abi.encode(creditId, actionHash, uint8(0)))
                )
        ) revert Unauthorized();
        usedReturn[actionHash] = true;
        held[creditId] -= amount;
        totalHeld -= amount;
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert Invalid();
        emit HeldCollateralReturned(creditId, actionHash, recipient, amount);
    }

    function _controllerPaused() internal view returns (bool) {
        return controller != address(0) && IRemoteRecoveryControllerIdentity(controller).paused();
    }
}
