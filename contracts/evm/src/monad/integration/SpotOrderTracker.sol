// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TermbookCore} from "../credit/TermbookCore.sol";
import {IntegrationRegistry} from "./IntegrationRegistry.sol";
import {ReadProgram} from "./ReadProgram.sol";
import {ExecutionTypes} from "./IExecutionPolicy.sol";

contract SpotOrderTracker {
    struct Rule {
        bytes32 id; bytes32 market; address target; address input; address custody;
        bytes32 counterProgram; bytes32 stateProgram; bytes32 balanceProgram;
        uint128 maximumInput; uint128 maximumQuantity; bool buy;
    }
    struct Capture { bytes32 rule; uint256 counter; uint256 quantity; uint256 price; }
    struct Order {
        bytes32 rule; uint256 venueId; uint256 committed; uint256 deadline;
        uint256 cancelRemaining; uint256 cancelBalance; bool cancelling; bool cancelled; bool settled;
    }
    address public immutable governance;
    TermbookCore public immutable core;
    IntegrationRegistry public immutable registry;
    ReadProgram public immutable programs;
    mapping(bytes32 => mapping(bytes32 => Rule)) private rules;
    mapping(bytes32 => Capture) private captures;
    mapping(bytes32 => mapping(bytes32 => Order)) private orders;
    mapping(bytes32 => bytes32[]) private ids;
    mapping(bytes32 => bytes32) public configurationHashes;
    error Invalid();
    event OrderCaptured(bytes32 indexed creditId, bytes32 indexed pendingId, uint256 venueId);

    constructor(address governance_, address core_, address registry_, address programs_) {
        if (governance_ == address(0) || core_.code.length == 0 || registry_.code.length == 0 || programs_.code.length == 0) revert Invalid();
        governance = governance_; core = TermbookCore(core_); registry = IntegrationRegistry(registry_); programs = ReadProgram(programs_);
    }

    function configure(bytes32 bundle, Rule[] calldata values) external {
        if (msg.sender != governance || bundle == bytes32(0) || configurationHashes[bundle] != bytes32(0)
            || values.length == 0 || values.length > 32) revert Invalid();
        for (uint256 i; i < values.length; ++i) {
            Rule calldata rule = values[i];
            if (rule.id == bytes32(0) || rule.market == bytes32(0) || rules[bundle][rule.id].id != bytes32(0)
                || rule.maximumInput == 0 || rule.maximumQuantity == 0 || rule.target.code.length == 0 || rule.custody.code.length == 0
                || rule.input != address(0) && !registry.dependencyValid(bundle, rule.input)) revert Invalid();
            _check(bundle, rule.counterProgram, rule.target);
            _check(bundle, rule.stateProgram, rule.target);
            _check(bundle, rule.balanceProgram, rule.custody);
            rules[bundle][rule.id] = rule;
        }
        configurationHashes[bundle] = keccak256(abi.encode(values));
    }

    function _check(bytes32 bundle, bytes32 program, address target) private view {
        address[] memory dependencies = programs.targets(program, target);
        if (dependencies.length == 0) revert Invalid();
        for (uint256 i; i < dependencies.length; ++i) if (!registry.dependencyValid(bundle, dependencies[i])) revert Invalid();
    }

    function _credit(bytes32 id, bool caller) private view returns (TermbookCore.Credit memory credit) {
        credit = core.creditDetails(id);
        if (credit.account == address(0) || caller && msg.sender != credit.account
            || configurationHashes[credit.bundleId] == bytes32(0) || !registry.dependenciesValid(credit.bundleId)) revert Invalid();
    }

    function _read(Rule storage rule, address account, bytes32 id, uint256 index) private view returns (uint256[] memory) {
        return programs.read(rule.stateProgram, ReadProgram.Context(rule.target, account, id, index, 0));
    }

    function _counter(Rule storage rule, address account, bytes32 id) private view returns (uint256) {
        uint256[] memory value = programs.read(rule.counterProgram, ReadProgram.Context(rule.target, account, id, 0, 0));
        if (value.length != 1) revert Invalid();
        return value[0];
    }

    function _balance(Rule storage rule, address account, bytes32 id) private view returns (uint256) {
        uint256[] memory value = programs.read(rule.balanceProgram,
            ReadProgram.Context(rule.custody, account, id, uint256(uint160(rule.input)), 0));
        if (value.length != 2 || value[0] != uint256(uint160(account))) revert Invalid();
        return value[1];
    }

    function beginOrder(bytes32 id, bytes32 ruleId, uint256 quantity, uint256 price) external {
        TermbookCore.Credit memory credit = _credit(id, true);
        Rule storage rule = rules[credit.bundleId][ruleId];
        if (captures[id].rule != bytes32(0) || rule.id == bytes32(0) || quantity == 0 || quantity > rule.maximumQuantity
            || price == 0 || block.timestamp >= credit.maturity) revert Invalid();
        uint256 i;
        while (i < ids[id].length) {
            ExecutionTypes.Status status = state(id, ids[id][i]).status;
            if (status == ExecutionTypes.Status.Pending || status == ExecutionTypes.Status.CancelRequested) { ++i; continue; }
            ids[id][i] = ids[id][ids[id].length - 1]; ids[id].pop();
        }
        if (ids[id].length >= 32) revert Invalid();
        captures[id] = Capture(ruleId, _counter(rule, credit.account, id), quantity, price);
    }

    function finishOrder(bytes32 id) external {
        TermbookCore.Credit memory credit = _credit(id, true);
        Capture memory capture = captures[id];
        if (capture.rule == bytes32(0)) revert Invalid();
        Rule storage rule = rules[credit.bundleId][capture.rule];
        uint256 counter = _counter(rule, credit.account, id);
        if (counter < capture.counter || counter - capture.counter > 32) revert Invalid();
        uint256 found;
        for (uint256 index = capture.counter + 1; index <= counter; ++index) {
            uint256[] memory data = _read(rule, credit.account, id, index);
            if (data.length != 6) revert Invalid();
            if (data[0] != uint256(uint160(credit.account)) || data[5] == 0) continue;
            if (++found > 1 || data[1] == 0 || data[1] > rule.maximumInput || data[2] == 0 || data[2] > capture.quantity
                || data[3] != capture.price || data[4] != (rule.buy ? 1 : 0) || data[5] != 1) revert Invalid();
            bytes32 pendingId = keccak256(abi.encode(rule.target, index));
            if (orders[id][pendingId].rule != bytes32(0)) revert Invalid();
            orders[id][pendingId] = Order(capture.rule, index, data[1], credit.maturity, 0, 0, false, false, false);
            ids[id].push(pendingId);
            emit OrderCaptured(id, pendingId, index);
        }
        delete captures[id];
    }

    function beginCancel(bytes32 id, address target, uint256 venueId) external {
        bytes32 pendingId = keccak256(abi.encode(target, venueId));
        TermbookCore.Credit memory credit = _credit(id, true);
        Order storage order = orders[id][pendingId];
        ExecutionTypes.PendingState memory current = state(id, pendingId);
        if (current.status != ExecutionTypes.Status.Pending) revert Invalid();
        Rule storage rule = rules[credit.bundleId][order.rule];
        order.cancelRemaining = current.remaining;
        order.cancelBalance = _balance(rule, credit.account, id);
        order.cancelling = true;
    }

    function state(bytes32 id, bytes32 pendingId) public view returns (ExecutionTypes.PendingState memory result) {
        TermbookCore.Credit memory credit = _credit(id, false);
        Order storage order = orders[id][pendingId];
        if (order.rule == bytes32(0)) revert Invalid();
        Rule storage rule = rules[credit.bundleId][order.rule];
        result.committed = order.committed; result.deadline = order.deadline;
        result.observedAt = block.timestamp; result.refundRecipient = credit.account;
        if (order.cancelled || order.settled) {
            result.refunded = order.cancelled ? order.cancelRemaining : 0;
            result.filled = order.committed - result.refunded;
            result.status = order.cancelled ? ExecutionTypes.Status.Cancelled : ExecutionTypes.Status.Settled;
            return result;
        }
        uint256[] memory data = _read(rule, credit.account, id, order.venueId);
        if (data.length != 6 || data[5] > 1 || data[1] > order.committed) revert Invalid();
        if (data[0] == uint256(uint160(credit.account)) && data[5] == 1) {
            if (data[4] != (rule.buy ? 1 : 0)) revert Invalid();
            result.remaining = data[1]; result.filled = order.committed - data[1];
            result.status = order.cancelling && data[1] == order.cancelRemaining ? ExecutionTypes.Status.CancelRequested : ExecutionTypes.Status.Pending;
        } else if (data[0] == 0 && order.cancelling) {
            if (_balance(rule, credit.account, id) < order.cancelBalance + order.cancelRemaining) revert Invalid();
            result.refunded = order.cancelRemaining; result.filled = order.committed - result.refunded;
            result.status = ExecutionTypes.Status.Cancelled;
        } else {
            if (data[0] != uint256(uint160(credit.account))) revert Invalid();
            result.filled = order.committed; result.status = ExecutionTypes.Status.Settled;
        }
    }

    function deadline(bytes32 id) external view returns (uint256) { return _credit(id, false).maturity; }

    function acknowledge(bytes32 id, bytes32 pendingId) external {
        if (msg.sender != address(core.executionManager())) revert Invalid();
        ExecutionTypes.Status status = state(id, pendingId).status;
        if (status == ExecutionTypes.Status.Cancelled) orders[id][pendingId].cancelled = true;
        else if (status == ExecutionTypes.Status.Settled) orders[id][pendingId].settled = true;
    }

    function count(bytes32 id) external view returns (uint256 result) {
        for (uint256 i; i < ids[id].length; ++i) {
            ExecutionTypes.Status status = state(id, ids[id][i]).status;
            if (status == ExecutionTypes.Status.Pending || status == ExecutionTypes.Status.CancelRequested) ++result;
        }
    }
    function lockedBalance(bytes32 id, address input) external view returns (uint256 result) {
        TermbookCore.Credit memory credit = _credit(id, false);
        for (uint256 i; i < ids[id].length; ++i) {
            if (rules[credit.bundleId][orders[id][ids[id][i]].rule].input != input) continue;
            result += state(id, ids[id][i]).remaining;
        }
    }
    function at(bytes32 id, uint256 index) external view returns (bytes32 pendingId, ExecutionTypes.PendingState memory result) {
        uint256 cursor;
        for (uint256 i; i < ids[id].length; ++i) {
            result = state(id, ids[id][i]);
            if (result.status != ExecutionTypes.Status.Pending && result.status != ExecutionTypes.Status.CancelRequested) continue;
            if (cursor++ == index) return (ids[id][i], result);
        }
        revert Invalid();
    }
    function details(bytes32 id, bytes32 pendingId) external view returns (bytes32 market, address input, uint256 venueId) {
        TermbookCore.Credit memory credit = _credit(id, false);
        Order storage order = orders[id][pendingId];
        if (order.rule == bytes32(0)) revert Invalid();
        Rule storage rule = rules[credit.bundleId][order.rule];
        return (rule.market, rule.input, order.venueId);
    }
}
