// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

import {ExecutionTypes, IExecutionPolicy} from "./IExecutionPolicy.sol";
import {IAppStateReader} from "./IAppStateReader.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";
import {IAppRecoveryAdapter} from "./IAppRecoveryAdapter.sol";
import {IAppRecoveryFunding} from "./IAppRecoveryFunding.sol";
import {IntegrationRegistry} from "./IntegrationRegistry.sol";

contract ExecutionManager is ProxyInitializable {
    struct Bundle {
        address policy;
        address reader;
        bytes32 policyCodeHash;
        bytes32 readerCodeHash;
        bytes32 policyHash;
        uint8 maxPositions;
        uint8 maxPending;
        uint32 maxAge;
    }
    struct Reservation { bytes32 beforeState; uint8 positionSlots; uint8 pendingSlots; uint256 exposure; uint256 positionsBefore; }
    struct Record {
        bytes32 capability;
        bytes32 market;
        uint256 exposureLimit;
        uint8 reservedSlots;
        ExecutionTypes.PendingState state;
    }
    struct Session {
        bytes32 bundleId;
        bytes32 permissionsHash;
        uint256 perAction;
        uint256 total;
        uint256 spent;
        uint256 maxExposure;
        uint256 aggregateExposure;
        uint256 exposureSpent;
        uint256 expiry;
        uint256 generation;
        uint256 nonce;
    }
    struct Permission { bytes32 capability; bytes32 market; }

    address public core;
    mapping(bytes32 => Bundle) public bundles;
    mapping(bytes32 => mapping(bytes32 => Record)) public records;
    mapping(bytes32 => bytes32[]) private pendingIds;
    mapping(bytes32 => mapping(bytes32 => uint256)) private pendingIndex;
    mapping(bytes32 => uint256) public reservedPositionSlots;
    mapping(bytes32 => bool) public breached;
    mapping(bytes32 => mapping(address => Session)) public sessions;
    mapping(bytes32 => mapping(address => mapping(bytes32 => bool))) public sessionPermissions;
    mapping(bytes32 => mapping(address => bytes32[])) private permissionKeys;

    error Unauthorized();
    error Invalid();
    error Bounds();
    error BadState();
    event ActionPending(bytes32 indexed creditId, bytes32 indexed pendingId, bytes32 capability, bytes32 market);
    event ActionReconciled(bytes32 indexed creditId, bytes32 indexed pendingId, ExecutionTypes.Status status,
        uint256 filled, uint256 refunded, uint256 remaining, uint256 liability);
    event ExecutionBoundBreached(bytes32 indexed creditId);
    event SessionConfigured(bytes32 indexed creditId, address indexed key, bytes32 permissionsHash);

    modifier onlyCore() { if (msg.sender != core) revert Unauthorized(); _; }
    constructor(address core_) {
        if (core_ != address(0)) _initializeExecutionManager(core_);
    }

    function initialize(address core_) external initializer {
        _initializeExecutionManager(core_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.ExecutionManager.v1");
    }

    function _initializeExecutionManager(address core_) private { if (core_ == address(0)) revert Invalid(); core = core_; }

    function configure(bytes32 bundleId, address policy, uint8 maxPositions, uint8 maxPending, uint32 maxAge)
        external onlyCore {
        if (bundleId == bytes32(0) || bundles[bundleId].policy != address(0) || policy.code.length == 0
            || CodeInspection.delegates(policy) || maxPositions == 0 || maxPositions > 32
            || maxPending > 32 || maxAge == 0 || maxAge > 15 minutes) revert Invalid();
        address reader = IExecutionPolicy(policy).stateReader();
        if (reader.code.length == 0 || CodeInspection.delegates(reader)
            || !IAppStateReader(reader).supportsInterface(type(IAppStateReader).interfaceId)) revert Invalid();
        bytes32 hash = keccak256(abi.encode(bundleId, policy, policy.codehash, reader, reader.codehash,
            maxPositions, maxPending, maxAge));
        bundles[bundleId] = Bundle(policy, reader, policy.codehash, reader.codehash, hash, maxPositions, maxPending, maxAge);
    }

    function policyHash(bytes32 bundleId) external view returns (bytes32) { return _bundle(bundleId).policyHash; }
    function pendingCount(bytes32 creditId) external view returns (uint256) { return pendingIds[creditId].length; }
    function pendingAt(bytes32 creditId, uint256 index) external view returns (bytes32) { return pendingIds[creditId][index]; }

    function prepareRecovery(bytes32 creditId, bytes32 bundleId, address account, address adapter,
        bytes calldata instruction, address registry) external view onlyCore
        returns (address target, bytes32 dataHash, bytes32 expectedState, bytes memory accountCall) {
        bytes memory data;
        uint256 nativeValue;
        (target, data, nativeValue, expectedState) = IAppRecoveryAdapter(adapter).recoveryCall(creditId, account, instruction);
        if (target == address(0) || target == account || target.code.length == 0 || data.length < 4) revert BadState();
        if (registry != address(0)
            && !IntegrationRegistry(registry).validateRecoveryValueCall(bundleId, target, data, account, nativeValue)) revert Unauthorized();
        if (nativeValue != 0 && registry == address(0)) revert Unauthorized();
        (bool queried, bytes memory answer) = adapter.staticcall(abi.encodeWithSignature("supportsInterface(bytes4)", type(IAppRecoveryFunding).interfaceId));
        if (queried && answer.length == 32 && abi.decode(answer, (bool))) {
            if (registry == address(0)) revert Unauthorized();
            (address token, uint256 amount) = IAppRecoveryFunding(adapter).recoverySpend(creditId, account, instruction);
            accountCall = abi.encodeWithSignature("executeRecoveryCall(bytes32,address,uint256,address,bytes,uint256,address)",
                bundleId, token, amount, target, data, nativeValue, registry);
        } else {
            accountCall = abi.encodeWithSignature("executeWithValue(address,bytes,uint256)", target, data, nativeValue);
        }
        dataHash = keccak256(data);
    }

    function verifyRecovery(bytes32 creditId, address account, address adapter, bytes calldata instruction,
        bytes32 expectedState) external view onlyCore {
        if (!IAppRecoveryAdapter(adapter).verifyRecovery(creditId, account, instruction, expectedState)) revert BadState();
    }

    function prepare(bytes32 creditId, bytes32 bundleId, address account, ExecutionTypes.Action calldata action)
        external onlyCore returns (Reservation memory reservation) {
        Bundle memory bundle = _bundle(bundleId);
        _sync(creditId, bundleId, account);
        if (breached[creditId] || action.capability == bytes32(0) || action.calls.length == 0
            || action.calls.length > 8) revert Bounds();
        uint256 size;
        for (uint256 i; i < action.calls.length; ++i) {
            ExecutionTypes.Call calldata call_ = action.calls[i];
            size += call_.data.length;
            if (call_.target.code.length == 0 || call_.data.length < 4
                || (call_.spendAmount != 0 && call_.spendToken.code.length == 0)) revert Invalid();
        }
        if (size > 16_384) revert Bounds();
        (reservation.beforeState, reservation.positionSlots, reservation.pendingSlots, reservation.exposure) =
            IExecutionPolicy(bundle.policy).prepare(creditId, account, action);
        reservation.positionsBefore = IAppStateReader(bundle.reader).positionCount(creditId, account);
        if (reservation.exposure > action.exposureLimit
            || reservation.positionsBefore + reservedPositionSlots[creditId]
                + reservation.positionSlots > bundle.maxPositions
            || pendingIds[creditId].length + reservation.pendingSlots > bundle.maxPending) revert Bounds();
    }

    function complete(bytes32 creditId, bytes32 bundleId, address account, ExecutionTypes.Action calldata action,
        Reservation calldata reservation, bytes[] calldata results) external onlyCore {
        Bundle memory bundle = _bundle(bundleId);
        bytes32[] memory ids = IExecutionPolicy(bundle.policy).verifyResult(creditId, account, action,
            reservation.beforeState, results);
        if (ids.length > reservation.pendingSlots || pendingIds[creditId].length + ids.length > bundle.maxPending) revert Bounds();
        uint256 slots;
        uint256 committed;
        uint256 liability;
        for (uint256 i; i < ids.length; ++i) {
            bytes32 id = ids[i];
            if (id == bytes32(0) || records[creditId][id].state.status != ExecutionTypes.Status.None) revert Invalid();
            ExecutionTypes.PendingState memory state = IExecutionPolicy(bundle.policy).pendingState(creditId, account, id);
            _validateState(state, account, bundle.maxAge);
            if (!_active(state.status)) revert Invalid();
            slots += state.positionSlots;
            committed += state.committed;
            if (state.liability > state.maxLiability) revert Bounds();
            liability += state.maxLiability;
            records[creditId][id] = Record(action.capability, action.market, state.maxLiability, state.positionSlots, state);
            pendingIds[creditId].push(id);
            pendingIndex[creditId][id] = pendingIds[creditId].length;
            emit ActionPending(creditId, id, action.capability, action.market);
        }
        if (slots > reservation.positionSlots || committed > action.requiredInput || liability > reservation.exposure) revert Bounds();
        if (IAppStateReader(bundle.reader).positionCount(creditId, account) > reservation.positionsBefore
            + reservation.positionSlots) revert Bounds();
        reservedPositionSlots[creditId] += slots;
        if (!_withinBounds(creditId, bundle, account)) revert Bounds();
    }

    function sync(bytes32 creditId, bytes32 bundleId, address account) external onlyCore returns (bool changed) {
        return _sync(creditId, bundleId, account);
    }

    function _sync(bytes32 creditId, bytes32 bundleId, address account) private returns (bool changed) {
        Bundle memory bundle = _bundle(bundleId);
        uint256 i;
        while (i < pendingIds[creditId].length) {
            bytes32 id = pendingIds[creditId][i];
            Record storage record = records[creditId][id];
            ExecutionTypes.PendingState memory state = IExecutionPolicy(bundle.policy).pendingState(creditId, account, id);
            _validateState(state, account, bundle.maxAge);
            if (state.committed != record.state.committed || state.filled < record.state.filled
                || state.refunded < record.state.refunded || state.remaining > record.state.remaining
                || state.positionSlots > record.state.positionSlots || state.deadline != record.state.deadline
                || state.maxLiability != record.exposureLimit
                || (record.state.positionId != bytes32(0) && state.positionId != record.state.positionId)) revert Invalid();
            if (state.liability > record.exposureLimit) breached[creditId] = true;
            reservedPositionSlots[creditId] = reservedPositionSlots[creditId] - record.state.positionSlots + state.positionSlots;
            ExecutionTypes.PendingState memory prior = record.state;
            uint256 observedAt = state.observedAt;
            state.observedAt = 0;
            prior.observedAt = 0;
            if (keccak256(abi.encode(state)) != keccak256(abi.encode(prior))) {
                changed = true;
                emit ActionReconciled(creditId, id, state.status, state.filled, state.refunded, state.remaining, state.liability);
            }
            state.observedAt = observedAt;
            record.state = state;
            if (_active(state.status)) { ++i; continue; }
            bytes32 last = pendingIds[creditId][pendingIds[creditId].length - 1];
            pendingIds[creditId][i] = last;
            pendingIndex[creditId][last] = i + 1;
            pendingIds[creditId].pop();
            delete pendingIndex[creditId][id];
            changed = true;
        }
        if (!_withinBounds(creditId, bundle, account)) {
            breached[creditId] = true;
            emit ExecutionBoundBreached(creditId);
        }
    }

    function _withinBounds(bytes32 creditId, Bundle memory bundle, address account) private view returns (bool) {
        IAppStateReader reader = IAppStateReader(bundle.reader);
        uint256 positions = reader.positionCount(creditId, account);
        uint256 pending = reader.pendingCount(creditId, account);
        if (positions > bundle.maxPositions || reservedPositionSlots[creditId] > bundle.maxPositions - positions
            || pending != pendingIds[creditId].length || pending > bundle.maxPending) return false;
        bytes32[32] memory positionKeys;
        bytes32[32] memory actionKeys;
        for (uint256 i; i < positions; ++i) {
            (bytes32 id,) = reader.positionAt(creditId, account, i);
            if (id == bytes32(0)) return false;
            for (uint256 j; j < i; ++j) if (positionKeys[j] == id) return false;
            positionKeys[i] = id;
        }
        for (uint256 i; i < pending; ++i) {
            (bytes32 id, bytes32 positionId, uint256 liability, uint256 deadline) = reader.pendingAt(creditId, account, i);
            if (pendingIndex[creditId][id] == 0) return false;
            for (uint256 j; j < i; ++j) if (actionKeys[j] == id) return false;
            actionKeys[i] = id;
            ExecutionTypes.PendingState memory state = records[creditId][id].state;
            if (state.positionId != positionId || state.liability != liability || state.deadline != deadline) return false;
        }
        return true;
    }

    function configureSession(bytes32 creditId, bytes32 bundleId, address key, Permission[] calldata permissions,
        uint256 perAction, uint256 total, uint256 maxExposure, uint256 aggregateExposure, uint256 expiry,
        uint256 generation) external onlyCore {
        _bundle(bundleId);
        if (key == address(0) || permissions.length == 0 || permissions.length > 16 || perAction == 0
            || total < perAction || maxExposure == 0 || aggregateExposure < maxExposure || expiry <= block.timestamp) revert Invalid();
        _clearPermissions(creditId, key);
        for (uint256 i; i < permissions.length; ++i) {
            bytes32 hash = keccak256(abi.encode(permissions[i].capability, permissions[i].market));
            if (permissions[i].capability == bytes32(0) || sessionPermissions[creditId][key][hash]) revert Invalid();
            permissionKeys[creditId][key].push(hash);
            sessionPermissions[creditId][key][hash] = true;
        }
        uint256 nonce = sessions[creditId][key].nonce + 1;
        bytes32 scope = keccak256(abi.encode(permissions));
        sessions[creditId][key] = Session(bundleId, scope, perAction, total, 0, maxExposure, aggregateExposure, 0,
            expiry, generation, nonce);
        emit SessionConfigured(creditId, key, scope);
    }

    function consumeSession(bytes32 creditId, bytes32 bundleId, address key, bytes32 capability, bytes32 market,
        uint256 spend, uint256 exposure, uint256 nonce, uint256 generation) external onlyCore {
        Session storage session = sessions[creditId][key];
        if (session.bundleId != bundleId || session.generation != generation || block.timestamp >= session.expiry
            || session.nonce != nonce || spend > session.perAction || spend > session.total - session.spent
            || exposure > session.maxExposure || exposure > session.aggregateExposure - session.exposureSpent
            || !sessionPermissions[creditId][key][keccak256(abi.encode(capability, market))]) revert Unauthorized();
        session.spent += spend;
        session.exposureSpent += exposure;
        session.nonce += 1;
    }

    function revokeSession(bytes32 creditId, address key) external onlyCore {
        _clearPermissions(creditId, key);
        sessions[creditId][key].expiry = 0;
        sessions[creditId][key].nonce += 1;
    }

    function _clearPermissions(bytes32 creditId, address key) private {
        for (uint256 i; i < permissionKeys[creditId][key].length; ++i) {
            delete sessionPermissions[creditId][key][permissionKeys[creditId][key][i]];
        }
        delete permissionKeys[creditId][key];
    }

    function _bundle(bytes32 bundleId) private view returns (Bundle memory bundle) {
        bundle = bundles[bundleId];
        if (bundle.policy == address(0) || bundle.policy.codehash != bundle.policyCodeHash
            || bundle.reader.codehash != bundle.readerCodeHash
            || IExecutionPolicy(bundle.policy).stateReader() != bundle.reader) revert Invalid();
    }

    function _active(ExecutionTypes.Status status) private pure returns (bool) {
        return status == ExecutionTypes.Status.Pending || status == ExecutionTypes.Status.CancelRequested;
    }

    function _validateState(ExecutionTypes.PendingState memory state, address account, uint256 maxAge) private view {
        if (state.status == ExecutionTypes.Status.None || state.refundRecipient != account || state.deadline == 0
            || state.observedAt == 0 || state.observedAt > block.timestamp || block.timestamp - state.observedAt > maxAge
            || state.filled + state.refunded + state.remaining != state.committed
            || (!_active(state.status) && (state.remaining != 0 || state.liability != 0 || state.positionSlots != 0))) revert Invalid();
    }
}
