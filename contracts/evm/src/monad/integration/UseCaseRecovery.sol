// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UseCaseReader} from "./UseCaseReader.sol";
import {TermbookCore} from "../credit/TermbookCore.sol";
import {IAppRecoveryAdapter} from "./IAppRecoveryAdapter.sol";
import {IAppRecoveryFunding} from "./IAppRecoveryFunding.sol";
import {IAppExitPlanner} from "./IAppExitPlanner.sol";
import {IExitVerifier} from "./IExitVerifier.sol";
import {ExecutionTypes} from "./IExecutionPolicy.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {FullMath} from "../../shared/FullMath.sol";

contract UseCaseRecovery is IAppRecoveryAdapter, IAppRecoveryFunding, IAppExitPlanner, IExitVerifier {
    using SafeTransferLib for address;
    enum Phase { Pending, Request, Position, Holding }
    enum Source { Literal, Account, Credit, Field, Minimum }
    struct Word { Source source; bytes32 value; }
    struct Template { Phase phase; bytes32 market; address target; bytes4 selector; Word[] words;
        address input; address output; uint8 spendField; uint8 minimumField; bool asynchronous; }
    struct Snapshot { bytes32 templateId; uint256 index; bytes32 objectId; uint256 beforeOutput; uint256 minimum; int256 beforeValue; uint256 lossBudget; bytes32 stateHash; }
    struct Plan { Snapshot snapshot; address target; bytes data; address input; address output; uint256 spend; uint256 minimum; }
    TermbookCore public immutable core;
    UseCaseReader public immutable reader;
    address public immutable governance;
    mapping(bytes32 => mapping(bytes32 => Template)) private templates;
    mapping(bytes32 => bytes32[]) private templateIds;
    mapping(bytes32 => bytes32) public configurationHashes;
    error Invalid();

    constructor(address governance_, address core_, address reader_) {
        if (governance_ == address(0) || core_.code.length == 0 || reader_.code.length == 0) revert Invalid();
        governance = governance_; core = TermbookCore(core_); reader = UseCaseReader(reader_);
    }
    function supportsInterface(bytes4 id) external pure returns (bool) { return id == type(IAppRecoveryFunding).interfaceId; }
    function configure(bytes32 bundle, Template[] calldata rules) external {
        if (msg.sender != governance || configurationHashes[bundle] != bytes32(0) || rules.length == 0 || rules.length > 64
            || reader.configurationHashes(bundle) == bytes32(0)) revert Invalid();
        for (uint256 i; i < rules.length; ++i) {
            Template calldata rule = rules[i];
            if (rule.target.code.length == 0 || rule.selector == bytes4(0) || rule.words.length > 24
                || rule.spendField != 255 && rule.spendField > 15 || rule.minimumField != 255 && rule.minimumField > 15) revert Invalid();
            for (uint256 j; j < rule.words.length; ++j) if (rule.words[j].source == Source.Field && uint256(rule.words[j].value) > 15) revert Invalid();
            for (uint256 j; j < i; ++j) if (rules[j].phase == rule.phase && rules[j].market == rule.market) revert Invalid();
            if (!reader.registry().dependencyValid(bundle, rule.target)
                || rule.input != address(0) && !reader.registry().dependencyValid(bundle, rule.input)
                || rule.output != address(0) && !reader.registry().dependencyValid(bundle, rule.output)) revert Invalid();
            bytes32 id = keccak256(abi.encode(rule));
            if (templates[bundle][id].target != address(0)) revert Invalid();
            templates[bundle][id] = rule; templateIds[bundle].push(id);
        }
        configurationHashes[bundle] = keccak256(abi.encode(rules));
    }
    function _bundle(bytes32 id, address account) private view returns (bytes32 bundle) {
        TermbookCore.Credit memory credit = core.creditDetails(id);
        if (credit.account != account || configurationHashes[credit.bundleId] == bytes32(0)) revert Invalid();
        return credit.bundleId;
    }
    function _value(bytes32 id, address account, address settlement) private view returns (int256) {
        (int256 appValue,,,) = reader.readAppValue(id, account, settlement);
        UseCaseReader.Meta memory state = reader.meta(id, account);
        uint256 cash = settlement.balanceOf(account) - state.reserved;
        if (cash > uint256(type(int256).max)) revert Invalid();
        return appValue + int256(cash);
    }
    function _fields(bytes32 id, address account, Phase phase, uint256 index) private view
        returns (uint256[16] memory fields, bytes32 objectId, bytes32 market, uint256 value, uint256 retryAt) {
        if (phase == Phase.Pending) {
            (bytes32 orderId, ExecutionTypes.PendingState memory state) = reader.order(id, account, index);
            objectId = orderId;
            (, market,,,) = core.executionManager().records(id, orderId);
            fields[0] = uint256(objectId); fields[1] = uint256(state.positionId); fields[2] = state.committed;
            fields[3] = state.remaining; fields[4] = state.liability; fields[5] = state.deadline; fields[6] = uint256(state.status);
            if (state.status == ExecutionTypes.Status.CancelRequested) retryAt = block.timestamp + 30;
        } else if (phase == Phase.Request) {
            UseCaseReader.Request memory state = reader.request(id, account, index);
            objectId = state.id; market = state.market;
            fields[0] = uint256(state.id); fields[1] = state.quantity0; fields[2] = state.claimableAt;
            fields[3] = state.quantity1; fields[4] = state.executableValue; fields[5] = state.liability;
            int256 net = reader.requestValue(id, account, index);
            value = net > 0 ? uint256(net) : 0;
            fields[4] = value;
            if (state.claimableAt > block.timestamp) retryAt = state.claimableAt > block.timestamp + 7 days ? block.timestamp + 7 days : state.claimableAt;
        } else if (phase == Phase.Position) {
            UseCaseReader.Position memory state = reader.position(id, account, index);
            objectId = state.id; market = state.market;
            fields = [uint256(state.id), uint256(state.market), state.quantity0, state.quantity1, state.rewards0, state.rewards1,
                state.margin, state.notional, uint256(state.pnl), state.liability, state.executableValue, state.shares,
                state.staked, state.liquidity, state.claimableAt, uint256(0)];
            int256 net = reader.positionValue(id, account, index);
            value = net > 0 ? uint256(net) : 0;
            fields[10] = value;
        } else {
            UseCaseReader.Config memory config = reader.config(_bundle(id, account));
            if (index >= config.assets.length) revert Invalid();
            UseCaseReader.Asset memory asset = config.assets[index];
            uint256 amount = reader.balance(asset.token, account);
            objectId = bytes32(uint256(uint160(asset.token))); market = objectId;
            fields[0] = uint256(uint160(asset.token)); fields[1] = amount;
            if (amount <= asset.dust) revert Invalid();
            uint8 decimals = uint8(_decimals(config.settlement));
            value = reader.assetValue(asset, amount, decimals);
            fields[2] = value; fields[3] = amount;
            if (asset.quoteProgram != bytes32(0)) {
                (uint256 available, uint256 proceeds) = reader.programs().quote(asset.quoteProgram, asset.quoteTarget,
                    amount < asset.maximum ? amount : asset.maximum);
                if (available > amount) revert Invalid();
                fields[1] = available;
                if (available == 0 || proceeds == 0) retryAt = block.timestamp + 30;
            }
        }
    }
    function _decimals(address token) private view returns (uint256 result) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length != 32) revert Invalid();
        result = abi.decode(data, (uint256)); if (result > 36) revert Invalid();
    }
    function _template(bytes32 bundle, Phase phase, bytes32 market) private view returns (bytes32 result) {
        for (uint256 i; i < templateIds[bundle].length; ++i) {
            bytes32 id = templateIds[bundle][i]; Template storage rule = templates[bundle][id];
            if (rule.phase != phase) continue;
            if (rule.market == market) return id;
            if (rule.market == bytes32(0)) result = id;
        }
        if (result == bytes32(0)) revert Invalid();
    }
    function _plan(bytes32 id, address account, Phase phase, uint256 index) private view returns (Plan memory plan, uint256 retryAt) {
        bytes32 bundle = _bundle(id, account);
        (uint256[16] memory fields, bytes32 objectId, bytes32 market, uint256 value, uint256 wait) = _fields(id, account, phase, index);
        if (wait != 0) return (plan, wait);
        UseCaseReader.Config memory config = reader.config(bundle);
        bytes32 templateId = _template(bundle, phase, market);
        Template storage rule = templates[bundle][templateId];
        plan.target = rule.target; plan.input = rule.input; plan.output = rule.output;
        if (rule.spendField != 255) plan.spend = fields[rule.spendField];
        if (rule.minimumField != 255 && !rule.asynchronous) plan.minimum = FullMath.mulDiv(fields[rule.minimumField], config.retainedBps, 10_000, false);
        plan.data = new bytes(4 + rule.words.length * 32);
        bytes4 selector = rule.selector;
        bytes memory data = plan.data;
        assembly ("memory-safe") { mstore(add(data, 32), selector) }
        for (uint256 i; i < rule.words.length; ++i) {
            Word storage word = rule.words[i];
            uint256 argument = word.source == Source.Literal ? uint256(word.value)
                : word.source == Source.Account ? uint256(uint160(account)) : word.source == Source.Credit ? uint256(id)
                : word.source == Source.Minimum ? plan.minimum : fields[uint256(word.value)];
            assembly ("memory-safe") { mstore(add(add(data, 36), mul(i, 32)), argument) }
        }
        UseCaseReader.Meta memory meta = reader.meta(id, account);
        uint256 budget = FullMath.mulDiv(value, 10_000 - config.retainedBps, 10_000, false);
        plan.snapshot = Snapshot(templateId, index, objectId, reader.balance(rule.output, account), plan.minimum, _value(id, account, config.settlement),
            budget, keccak256(abi.encode(meta, fields)));
    }
    function nextExitStep(bytes32 id, address account) external view returns (bytes32, bytes memory, uint256) {
        UseCaseReader.Meta memory meta = reader.meta(id, account);
        uint256 wait;
        for (uint256 kind; kind < 4; ++kind) {
            uint256 count = kind == 0 ? meta.pending : kind == 1 ? meta.requests : kind == 2 ? meta.positions : reader.config(_bundle(id, account)).assets.length;
            for (uint256 i; i < count; ++i) {
                if (kind == 3) { UseCaseReader.Asset memory asset = reader.config(_bundle(id, account)).assets[i]; if (reader.balance(asset.token, account) <= asset.dust) continue; }
                (Plan memory plan, uint256 retryAt) = _plan(id, account, Phase(kind), i);
                if (retryAt != 0) { if (wait == 0 || retryAt < wait) wait = retryAt; continue; }
                bytes memory instruction = abi.encode(uint8(kind), i, plan.snapshot);
                return (keccak256(instruction), instruction, 0);
            }
        }
        return (bytes32(0), "", wait);
    }
    function recoveryCall(bytes32 id, address account, bytes calldata instruction) external view returns (address, bytes memory, uint256, bytes32) {
        (uint8 kind, uint256 index, Snapshot memory snapshot) = abi.decode(instruction, (uint8, uint256, Snapshot));
        if (kind > 3) revert Invalid();
        (Plan memory plan, uint256 retryAt) = _plan(id, account, Phase(kind), index);
        if (retryAt != 0 || keccak256(abi.encode(snapshot)) != keccak256(abi.encode(plan.snapshot))) revert Invalid();
        return (plan.target, plan.data, plan.input == address(0) ? plan.spend : 0, keccak256(instruction));
    }
    function recoverySpend(bytes32 id, address account, bytes calldata instruction) external view returns (address, uint256) {
        (uint8 kind, uint256 index,) = abi.decode(instruction, (uint8, uint256, Snapshot));
        if (kind > 3) revert Invalid();
        (Plan memory plan, uint256 retryAt) = _plan(id, account, Phase(kind), index);
        if (retryAt != 0) revert Invalid();
        return (plan.input, plan.input == address(0) ? 0 : plan.spend);
    }
    function verifyRecovery(bytes32 id, address account, bytes calldata instruction, bytes32 expected) external view returns (bool) {
        if (expected != keccak256(instruction)) return false;
        (uint8 kind, uint256 index, Snapshot memory snapshot) = abi.decode(instruction, (uint8, uint256, Snapshot));
        bytes32 bundle = _bundle(id, account); Template storage rule = templates[bundle][snapshot.templateId];
        if (rule.target == address(0)) return false;
        int256 afterValue = _value(id, account, reader.config(bundle).settlement);
        if (snapshot.lossBudget > uint256(type(int256).max) || afterValue < snapshot.beforeValue - int256(snapshot.lossBudget)
            || reader.balance(rule.output, account) < snapshot.beforeOutput + snapshot.minimum) return false;
        UseCaseReader.Meta memory meta = reader.meta(id, account);
        uint256[16] memory fields;
        bool present = kind == 0 ? index < meta.pending : kind == 1 ? index < meta.requests : kind == 2 ? index < meta.positions
            : index < reader.config(bundle).assets.length && reader.balance(reader.config(bundle).assets[index].token, account) > reader.config(bundle).assets[index].dust;
        if (present) (fields,,,,) = _fields(id, account, Phase(kind), index);
        bytes32 afterHash = keccak256(abi.encode(meta, fields));
        return afterHash != snapshot.stateHash;
    }
    function canExit(bytes32 id, address account) external view returns (bool) {
        UseCaseReader.Meta memory meta = reader.meta(id, account);
        return meta.reserved == 0 && meta.requests == 0 && reader.positionCount(id, account) == 0 && reader.pendingCount(id, account) == 0;
    }
}
