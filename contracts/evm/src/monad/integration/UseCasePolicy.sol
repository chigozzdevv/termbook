// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UseCaseReader} from "./UseCaseReader.sol";
import {TermbookCore} from "../credit/TermbookCore.sol";
import {ExecutionTypes, IExecutionPolicy} from "./IExecutionPolicy.sol";
import {IAppCallValidator} from "./IAppCallValidator.sol";

contract UseCasePolicy is IExecutionPolicy, IAppCallValidator {
    enum Kind { Exact, Account, Range, Spend, Credit }
    struct Word { Kind kind; bytes32 exact; uint256 minimum; uint256 maximum; }
    struct Call { address target; bytes4 selector; bool recovery; Word[] words; uint256 maximumNative; uint8 nativeWord; }
    struct Action { bytes32 id; bytes32 market; bytes32 operation; uint128 maximumInput; uint128 maximumExposure; bool asynchronous; Call[] calls; }
    address public immutable governance;
    TermbookCore public immutable core;
    UseCaseReader public immutable reader;
    mapping(bytes32 => mapping(bytes32 => Action)) private actions;
    mapping(bytes32 => mapping(address => mapping(bytes4 => Call))) private calls;
    mapping(bytes32 => bytes32) public configurationHashes;
    error Invalid();

    constructor(address governance_, address core_, address reader_) {
        if (governance_ == address(0) || core_.code.length == 0 || reader_.code.length == 0) revert Invalid();
        governance = governance_; core = TermbookCore(core_); reader = UseCaseReader(reader_);
    }
    function stateReader() external view returns (address) { return address(reader); }

    function configure(bytes32 bundle, Action[] calldata actionRules, Call[] calldata callRules) external {
        if (msg.sender != governance || bundle == bytes32(0) || configurationHashes[bundle] != bytes32(0)
            || reader.configurationHashes(bundle) == bytes32(0) || actionRules.length == 0 || actionRules.length > 32
            || callRules.length == 0 || callRules.length > 64) revert Invalid();
        UseCaseReader.Config memory config = reader.config(bundle);
        for (uint256 i; i < actionRules.length; ++i) {
            Action calldata action = actionRules[i];
            if (action.id == bytes32(0) || actions[bundle][action.id].id != bytes32(0) || !_allowed(config.useCase, action.operation)) revert Invalid();
            if (action.calls.length == 0 || action.calls.length > 8) revert Invalid();
            for (uint256 j; j < action.calls.length; ++j) _checkCall(action.calls[j]);
            actions[bundle][action.id] = action;
        }
        for (uint256 i; i < callRules.length; ++i) {
            Call calldata call_ = callRules[i];
            _checkCall(call_);
            if (calls[bundle][call_.target][call_.selector].target != address(0)) revert Invalid();
            calls[bundle][call_.target][call_.selector] = call_;
        }
        configurationHashes[bundle] = keccak256(abi.encode(actionRules, callRules));
    }

    function _checkCall(Call calldata call_) private view {
        if (call_.target.code.length == 0 || call_.selector == bytes4(0) || call_.words.length > 24 || call_.maximumNative != 0 && call_.nativeWord != 255 && call_.nativeWord >= call_.words.length) revert Invalid();
        for (uint256 j; j < call_.words.length; ++j) {
            Word calldata word = call_.words[j];
            if (word.minimum > word.maximum || word.kind == Kind.Exact && (word.minimum != 0 || word.maximum != 0)
                || word.kind == Kind.Account && (word.exact != bytes32(0) || word.minimum != 0 || word.maximum != 0)
                || word.kind >= Kind.Range && word.exact != bytes32(0)) revert Invalid();
        }
    }
    function _allowed(UseCaseReader.UseCase useCase, bytes32 operation) private pure returns (bool) {
        if (useCase == UseCaseReader.UseCase.Spot) return operation == keccak256("place_order") || operation == keccak256("modify_order") || operation == keccak256("cancel_order");
        if (useCase == UseCaseReader.UseCase.Perps) return operation == keccak256("place_order") || operation == keccak256("increase_position")
            || operation == keccak256("decrease_position") || operation == keccak256("add_margin") || operation == keccak256("remove_margin")
            || operation == keccak256("cancel_order") || operation == keccak256("close_position");
        if (useCase == UseCaseReader.UseCase.Vault) return operation == keccak256("deposit_vault") || operation == keccak256("redeem_vault")
            || operation == keccak256("claim_rewards") || operation == keccak256("withdraw_to_credit_account");
        if (useCase == UseCaseReader.UseCase.Staking) return operation == keccak256("stake") || operation == keccak256("claim_rewards")
            || operation == keccak256("request_unstake") || operation == keccak256("complete_unstake") || operation == keccak256("withdraw_to_credit_account");
        return operation == keccak256("add_liquidity") || operation == keccak256("remove_liquidity") || operation == keccak256("stake_lp")
            || operation == keccak256("unstake_lp") || operation == keccak256("claim_rewards") || operation == keccak256("collect_fees");
    }

    function _priced(bytes32 operation) private pure returns (bool) {
        return operation == keccak256("place_order") || operation == keccak256("modify_order") || operation == keccak256("increase_position")
            || operation == keccak256("decrease_position") || operation == keccak256("close_position");
    }
    function _creates(bytes32 operation) private pure returns (bool) {
        return operation == keccak256("place_order") || operation == keccak256("deposit_vault")
            || operation == keccak256("stake") || operation == keccak256("add_liquidity");
    }
    function prepare(bytes32 id, address account, ExecutionTypes.Action calldata action) external view returns (bytes32 beforeState, uint8 positionSlots, uint8 pendingSlots, uint256 exposure) {
        TermbookCore.Credit memory credit = core.creditDetails(id);
        Action storage rule = actions[credit.bundleId][action.capability];
        if (credit.account != account || rule.id == bytes32(0) || action.calls.length == 0 || action.calls.length > 8
            || rule.market != bytes32(0) && action.market != rule.market || action.requiredInput > rule.maximumInput
            || action.calls.length != rule.calls.length || action.exposureLimit > rule.maximumExposure
            || _priced(rule.operation) && core.priceProtection().rule(credit.bundleId, action.capability, action.market).oracle == address(0)) revert Invalid();
        for (uint256 i; i < action.calls.length; ++i) if (!_validateRule(rule.calls[i], action.calls[i].target,
            action.calls[i].data, account, action.calls[i].spendAmount, false, id, action.calls[i].nativeValue)) revert Invalid();
        uint256 positions = reader.positionCount(id, account);
        uint256 pending = reader.pendingCount(id, account);
        positionSlots = _creates(rule.operation) ? 1 : 0;
        UseCaseReader.Config memory config = reader.config(credit.bundleId);
        if (config.orderTracker != address(0)) positionSlots = uint8(config.maxPositions - positions);
        if (config.orderTracker == address(0) && positionSlots != 0 && !rule.asynchronous && config.useCase == UseCaseReader.UseCase.Spot) {
            for (uint256 i; i < positions; ++i) { (, bytes32 market) = reader.positionAt(id, account, i); if (market == action.market) { positionSlots = 0; break; } }
        }
        beforeState = bytes32((positions << 248) | (pending << 240) | (uint256(positionSlots) << 232) | _exposure(id, account));
        pendingSlots = rule.asynchronous ? 1 : 0;
        exposure = action.exposureLimit;
    }

    function verifyResult(bytes32 id, address account, ExecutionTypes.Action calldata action, bytes32 beforeState, bytes[] calldata results)
        external view returns (bytes32[] memory pendingIds) {
        TermbookCore.Credit memory credit = core.creditDetails(id);
        Action storage rule = actions[credit.bundleId][action.capability];
        if (credit.account != account || rule.id == bytes32(0) || results.length != action.calls.length
            || reader.positionCount(id, account) > (uint256(beforeState) >> 248) + uint8(uint256(beforeState) >> 232)
            || _exposure(id, account) > (uint256(beforeState) & ((uint256(1) << 232) - 1)) + action.exposureLimit) revert Invalid();
        uint256 count = reader.pendingCount(id, account);
        bytes32[] memory fresh = new bytes32[](32);
        uint256 added;
        for (uint256 i; i < count; ++i) {
            (bytes32 pendingId,,,) = reader.pendingAt(id, account, i);
            (,,,, ExecutionTypes.PendingState memory stored) = core.executionManager().records(id, pendingId);
            if (stored.status == ExecutionTypes.Status.None) fresh[added++] = pendingId;
        }
        if (added > (rule.asynchronous ? 1 : 0)) revert Invalid();
        pendingIds = new bytes32[](added);
        for (uint256 i; i < added; ++i) pendingIds[i] = fresh[i];
    }
    function _exposure(bytes32 id, address account) private view returns (uint256 value) {
        TermbookCore.Credit memory credit = core.creditDetails(id);
        if (reader.config(credit.bundleId).useCase != UseCaseReader.UseCase.Perps) return 0;
        UseCaseReader.Meta memory state = reader.meta(id, account);
        for (uint256 i; i < state.positions; ++i) value += reader.position(id, account, i).notional;
        for (uint256 i; i < state.pending; ++i) value += reader.pendingExposure(id, account, i);
        if (value >= uint256(1) << 232) revert Invalid();
    }
    function pendingState(bytes32 id, address account, bytes32 pendingId) external view returns (ExecutionTypes.PendingState memory) {
        return reader.reconcile(id, account, pendingId);
    }
    function pendingInputAsset(bytes32 id, address account, bytes32 pendingId) external view returns (address input) {
        (, input,) = reader.pendingDetails(id, account, pendingId);
    }
    function pendingTracker(bytes32 id) external view returns (address) {
        return reader.config(core.creditDetails(id).bundleId).orderTracker;
    }

    function validateAction(bytes32 bundle, address target, bytes calldata data, address account, uint256 spend) external view returns (bool) {
        return _validate(bundle, target, data, account, spend, false);
    }
    function validateRecovery(bytes32 bundle, address target, bytes calldata data, address account) external view returns (bool) {
        return _validate(bundle, target, data, account, type(uint256).max, true);
    }
    function _validate(bytes32 bundle, address target, bytes calldata data, address account, uint256 spend, bool recovery) private view returns (bool) {
        if (data.length < 4 || account == address(0)) return false;
        Call storage rule = calls[bundle][target][bytes4(data)];
        (bool ok, bytes memory value) = account.staticcall(abi.encodeWithSignature("creditId()"));
        bytes32 id = ok && value.length == 32 ? abi.decode(value, (bytes32)) : bytes32(0);
        return _validateRule(rule, target, data, account, spend, recovery, id, type(uint256).max);
    }
    function _validateRule(Call storage rule, address target, bytes calldata data, address account, uint256 spend, bool recovery, bytes32 creditId, uint256 nativeValue) private view returns (bool) {
        if (rule.target != target || bytes4(data) != rule.selector || account == address(0) || recovery && !rule.recovery || data.length != 4 + rule.words.length * 32) return false;
        if (nativeValue != type(uint256).max && (nativeValue > rule.maximumNative || rule.maximumNative == 0 && nativeValue != 0)) return false;
        for (uint256 i; i < rule.words.length; ++i) {
            uint256 word;
            assembly ("memory-safe") { word := calldataload(add(data.offset, add(4, mul(i, 32)))) }
            if (nativeValue != type(uint256).max && rule.maximumNative != 0 && rule.nativeWord == i && word != nativeValue) return false;
            Word storage constraint = rule.words[i];
            if (constraint.kind == Kind.Exact && bytes32(word) != constraint.exact
                || constraint.kind == Kind.Account && word != uint256(uint160(account))
                || constraint.kind == Kind.Credit && bytes32(word) != creditId
                || (constraint.kind == Kind.Range || constraint.kind == Kind.Spend) && (word < constraint.minimum || word > constraint.maximum)
                || constraint.kind == Kind.Spend && word > spend) return false;
        }
        return true;
    }
}
