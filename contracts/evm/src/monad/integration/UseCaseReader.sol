// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TermbookCore} from "../credit/TermbookCore.sol";
import {IntegrationRegistry} from "./IntegrationRegistry.sol";
import {ReadProgram} from "./ReadProgram.sol";
import {OracleRegistry} from "../risk/OracleRegistry.sol";
import {FullMath} from "../../shared/FullMath.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {IAppStateReader} from "./IAppStateReader.sol";
import {IAppValueReader} from "./IAppValueReader.sol";
import {IAppCashReader} from "./IAppCashReader.sol";
import {ExecutionTypes} from "./IExecutionPolicy.sol";

contract UseCaseReader is IAppStateReader, IAppValueReader, IAppCashReader {
    using SafeTransferLib for address;
    enum UseCase { Spot, Perps, Vault, Staking, Liquidity }
    struct Asset { address token; address oracle; bytes32 feed; uint8 decimals; uint128 maximum; uint128 dust; bytes32 quoteProgram; address quoteTarget; }
    struct Market { bytes32 id; address receipt; Asset asset0; Asset asset1; uint128 maximumExposure; }
    struct Config {
        UseCase useCase; address settlement; address stateTarget; bytes32 metaProgram; bytes32 positionProgram;
        bytes32 pendingProgram; bytes32 requestProgram; bytes32 reconcileProgram; uint16 retainedBps; uint128 recoveryCosts;
        uint8 maxPositions; uint8 maxPending; uint8 maxRequests; Asset[] assets; Market[] markets;
    }
    struct Meta { uint256 positions; uint256 pending; uint256 requests; uint256 reserved; }
    struct Position {
        address owner; bytes32 id; bytes32 market; uint256 quantity0; uint256 quantity1; uint256 rewards0; uint256 rewards1;
        uint256 margin; uint256 notional; int256 pnl; uint256 liability; uint256 executableValue;
        uint256 shares; uint256 staked; uint256 liquidity; uint256 claimableAt;
    }
    struct Request { address owner; bytes32 id; bytes32 market; uint256 quantity0; uint256 quantity1; uint256 liability; uint256 executableValue; uint256 claimableAt; bytes32 replacesPositionId; }
    TermbookCore public immutable core;
    IntegrationRegistry public immutable registry;
    ReadProgram public immutable programs;
    address public immutable governance;
    mapping(bytes32 => Config) private configs;
    mapping(bytes32 => bytes32) public configurationHashes;
    error Invalid();

    constructor(address governance_, address core_, address registry_, address programs_) {
        if (governance_ == address(0) || core_.code.length == 0 || registry_.code.length == 0 || programs_.code.length == 0) revert Invalid();
        governance = governance_; core = TermbookCore(core_); registry = IntegrationRegistry(registry_); programs = ReadProgram(programs_);
    }

    function configure(bytes32 bundle, Config calldata value) external {
        if (msg.sender != governance || bundle == bytes32(0) || configurationHashes[bundle] != bytes32(0)
            || value.settlement.code.length == 0 || value.retainedBps == 0 || value.retainedBps > 10_000
            || value.maxPositions == 0 || value.maxPositions > 32 || value.maxPending > 32 || value.maxRequests > 32
            || value.assets.length > 16 || value.markets.length > 16
            || value.useCase != UseCase.Spot && (value.metaProgram == bytes32(0) || value.positionProgram == bytes32(0))
            || value.metaProgram != bytes32(0) && value.stateTarget.code.length == 0) revert Invalid();
        bytes32[5] memory ids = [value.metaProgram, value.positionProgram, value.pendingProgram, value.requestProgram, value.reconcileProgram];
        for (uint256 i; i < ids.length; ++i) if (ids[i] != bytes32(0)) _checkProgram(bundle, ids[i], value.stateTarget);
        if ((value.pendingProgram != bytes32(0) || value.requestProgram != bytes32(0)) && value.reconcileProgram == bytes32(0)) revert Invalid();
        for (uint256 i; i < value.assets.length; ++i) {
            _checkAsset(bundle, value.assets[i]);
            if (value.assets[i].quoteProgram == bytes32(0)) revert Invalid();
            if (value.assets[i].token == value.settlement) revert Invalid();
            for (uint256 j; j < i; ++j) if (value.assets[j].token == value.assets[i].token) revert Invalid();
        }
        for (uint256 i; i < value.markets.length; ++i) {
            Market calldata market = value.markets[i];
            if (market.id == bytes32(0) || market.maximumExposure == 0) revert Invalid();
            _checkAsset(bundle, market.asset0);
            if (value.useCase == UseCase.Liquidity) _checkAsset(bundle, market.asset1);
            for (uint256 j; j < i; ++j) if (value.markets[j].id == market.id) revert Invalid();
            for (uint256 j; j < value.assets.length; ++j) if (market.receipt != address(0) && market.receipt == value.assets[j].token) revert Invalid();
        }
        configs[bundle] = value;
        configurationHashes[bundle] = keccak256(abi.encode(value));
    }

    function _checkAsset(bytes32 bundle, Asset calldata asset) private view {
        if (asset.oracle.code.length == 0 || asset.feed == bytes32(0) || asset.decimals > 36 || asset.maximum == 0
            || asset.dust >= asset.maximum || asset.token != address(0) && asset.token.code.length == 0
            || asset.quoteProgram != bytes32(0) && (programs.programHashes(asset.quoteProgram) == bytes32(0) || asset.quoteTarget.code.length == 0)) revert Invalid();
        if (!registry.dependencyValid(bundle, asset.oracle) || asset.token != address(0) && !registry.dependencyValid(bundle, asset.token)) revert Invalid();
        if (asset.token != address(0) && _decimals(asset.token) != asset.decimals) revert Invalid();
        if (asset.quoteProgram != bytes32(0)) _checkProgram(bundle, asset.quoteProgram, asset.quoteTarget);
        OracleRegistry(asset.oracle).read(asset.feed);
    }

    function _checkProgram(bytes32 bundle, bytes32 program, address target) private view {
        address[] memory dependencies = programs.targets(program, target);
        if (dependencies.length == 0) revert Invalid();
        for (uint256 i; i < dependencies.length; ++i) if (!registry.dependencyValid(bundle, dependencies[i])) revert Invalid();
    }
    function _decimals(address token) private view returns (uint8) {
        (bool ok, bytes memory output) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || output.length != 32 || abi.decode(output, (uint256)) > 36) revert Invalid();
        return uint8(abi.decode(output, (uint256)));
    }

    function config(bytes32 bundle) external view returns (Config memory) { return configs[bundle]; }
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IAppStateReader).interfaceId || id == type(IAppValueReader).interfaceId || id == type(IAppCashReader).interfaceId;
    }

    function _bundle(bytes32 id, address account) private view returns (bytes32 bundle) {
        TermbookCore.Credit memory credit = core.creditDetails(id);
        bundle = credit.bundleId;
        if (credit.account != account || account == address(0) || configurationHashes[bundle] == bytes32(0)
            || !registry.dependenciesValid(bundle) || !registry.dependencyValid(bundle, address(programs))) revert Invalid();
    }

    function meta(bytes32 id, address account) public view returns (Meta memory result) {
        Config storage value = configs[_bundle(id, account)];
        if (value.metaProgram == bytes32(0)) return result;
        uint256[] memory data = programs.read(value.metaProgram, ReadProgram.Context(value.stateTarget, account, id, 0, 0));
        if (data.length != 5 || data[0] != uint256(uint160(account)) || data[1] > value.maxPositions
            || data[2] > value.maxPending || data[3] > value.maxRequests || data[2] + data[3] > value.maxPending
            || data[2] != 0 && value.pendingProgram == bytes32(0) || data[3] != 0 && value.requestProgram == bytes32(0)
            || data[1] != 0 && value.positionProgram == bytes32(0) || data[4] > value.settlement.balanceOf(account)) revert Invalid();
        return Meta(data[1], data[2], data[3], data[4]);
    }

    function position(bytes32 id, address account, uint256 index) public view returns (Position memory result) {
        Config storage value = configs[_bundle(id, account)];
        if (index >= meta(id, account).positions) revert Invalid();
        uint256[] memory data = programs.read(value.positionProgram, ReadProgram.Context(value.stateTarget, account, id, index, 0));
        if (data.length != 16 || data[0] != uint256(uint160(account)) || data[1] == 0 || data[2] == 0) revert Invalid();
        result = Position(account, bytes32(data[1]), bytes32(data[2]), data[3], data[4], data[5], data[6], data[7], data[8],
            int256(data[9]), data[10], data[11], data[12], data[13], data[14], data[15]);
        Market storage market = _market(value, result.market);
        if (result.notional > market.maximumExposure || result.executableValue > uint256(type(int256).max)
            || result.liability > uint256(type(int256).max) || result.margin > uint256(type(int256).max)
            || value.useCase == UseCase.Vault && result.shares == 0
            || value.useCase == UseCase.Staking && result.staked == 0
            || value.useCase == UseCase.Liquidity && result.liquidity == 0) revert Invalid();
    }

    function _market(Config storage value, bytes32 id) private view returns (Market storage market) {
        for (uint256 i; i < value.markets.length; ++i) if (value.markets[i].id == id) return value.markets[i];
        revert Invalid();
    }

    function request(bytes32 id, address account, uint256 index) public view returns (Request memory) {
        Config storage value = configs[_bundle(id, account)];
        if (index >= meta(id, account).requests) revert Invalid();
        uint256[] memory data = programs.read(value.requestProgram, ReadProgram.Context(value.stateTarget, account, id, index, 0));
        if (data.length != 9 || data[0] != uint256(uint160(account)) || data[1] == 0 || data[2] == 0
            || data[5] > uint256(type(int256).max) || data[6] > uint256(type(int256).max)) revert Invalid();
        _market(value, bytes32(data[2]));
        return Request(account, bytes32(data[1]), bytes32(data[2]), data[3], data[4], data[5], data[6], data[7], bytes32(data[8]));
    }

    function order(bytes32 id, address account, uint256 index) public view returns (bytes32 orderId, ExecutionTypes.PendingState memory result) {
        Config storage value = configs[_bundle(id, account)];
        if (index >= meta(id, account).pending) revert Invalid();
        uint256[] memory data = programs.read(value.pendingProgram, ReadProgram.Context(value.stateTarget, account, id, index, 0));
        (orderId, result) = _order(account, data);
        if (result.status != ExecutionTypes.Status.Pending && result.status != ExecutionTypes.Status.CancelRequested) revert Invalid();
    }

    function pendingExposure(bytes32 id, address account, uint256 index) external view returns (uint256) {
        Config storage value = configs[_bundle(id, account)];
        if (index >= meta(id, account).pending) revert Invalid();
        uint256[] memory data = programs.read(value.pendingProgram, ReadProgram.Context(value.stateTarget, account, id, index, 0));
        _order(account, data);
        return data[7];
    }
    function reconcile(bytes32 id, address account, bytes32 pendingId) external view returns (ExecutionTypes.PendingState memory result) {
        Config storage value = configs[_bundle(id, account)];
        if (value.reconcileProgram == bytes32(0)) revert Invalid();
        uint256[] memory data = programs.read(value.reconcileProgram, ReadProgram.Context(value.stateTarget, account, id, uint256(pendingId), 0));
        (bytes32 actual, ExecutionTypes.PendingState memory state) = _order(account, data);
        if (actual != pendingId) revert Invalid();
        return state;
    }

    function _order(address account, uint256[] memory data) private view returns (bytes32 orderId, ExecutionTypes.PendingState memory result) {
        if (data.length != 14 || data[0] != uint256(uint160(account)) || data[1] == 0 || data[11] > 32
            || data[12] != uint256(uint160(account)) || data[13] == 0 || data[13] > uint256(ExecutionTypes.Status.Expired)
            || data[7] > type(uint128).max || data[8] > data[9] || data[9] > uint256(type(int256).max)
            || data[4] + data[5] + data[6] != data[3]) revert Invalid();
        orderId = bytes32(data[1]);
        result = ExecutionTypes.PendingState(bytes32(data[2]), data[3], data[4], data[5], data[6], data[8], data[9],
            data[10], block.timestamp, uint8(data[11]), account, ExecutionTypes.Status(data[13]));
    }

    function positionCount(bytes32 id, address account) public view returns (uint256 count) {
        Config storage value = configs[_bundle(id, account)];
        count = meta(id, account).positions;
        for (uint256 i; i < value.assets.length; ++i) if (_balance(value.assets[i].token, account) > value.assets[i].dust) ++count;
    }
    function positionAt(bytes32 id, address account, uint256 index) external view returns (bytes32, bytes32) {
        uint256 nativePositions = meta(id, account).positions;
        if (index < nativePositions) { Position memory item = position(id, account, index); return (item.id, item.market); }
        Config storage value = configs[_bundle(id, account)];
        uint256 cursor = nativePositions;
        for (uint256 i; i < value.assets.length; ++i) if (_balance(value.assets[i].token, account) > value.assets[i].dust) {
            if (cursor++ == index) {
                bytes32 market = keccak256(abi.encode(value.assets[i].token));
                for (uint256 j; j < value.markets.length; ++j) if (value.markets[j].asset0.token == value.assets[i].token) { market = value.markets[j].id; break; }
                return (keccak256(abi.encode(account, value.assets[i].token)), market);
            }
        }
        revert Invalid();
    }
    function pendingCount(bytes32 id, address account) external view returns (uint256) { Meta memory value = meta(id, account); return value.pending + value.requests; }
    function pendingAt(bytes32 id, address account, uint256 index) external view returns (bytes32, bytes32, uint256, uint256) {
        Meta memory value = meta(id, account);
        if (index < value.pending) { (bytes32 orderId, ExecutionTypes.PendingState memory item) = order(id, account, index); return (orderId, item.positionId, item.liability, item.deadline); }
        Request memory item = request(id, account, index - value.pending); return (item.id, bytes32(0), 0, item.claimableAt);
    }
    function reservedCash(bytes32 id, address account, address settlement) external view returns (uint256, uint256) {
        if (settlement != configs[_bundle(id, account)].settlement) revert Invalid();
        return (meta(id, account).reserved, block.timestamp);
    }

    function _balance(address token, address account) private view returns (uint256) { return token == address(0) ? account.balance : token.balanceOf(account); }
    function balance(address token, address account) external view returns (uint256) { return _balance(token, account); }
    function assetValue(Asset memory asset, uint256 amount, uint8 settlementDecimals) public view returns (uint256 result) {
        if (amount > asset.maximum) amount = asset.maximum;
        if (amount <= asset.dust) return 0;
        (uint256 price,,) = OracleRegistry(asset.oracle).read(asset.feed);
        result = FullMath.mulDiv(amount, price, 10 ** asset.decimals, false);
        result = FullMath.mulDiv(result, 10 ** settlementDecimals, 1e18, false);
        if (asset.quoteProgram != bytes32(0)) {
            (uint256 available, uint256 proceeds) = programs.quote(asset.quoteProgram, asset.quoteTarget, amount);
            if (available > amount) revert Invalid();
            uint256 executable = FullMath.mulDiv(available, price, 10 ** asset.decimals, false);
            executable = FullMath.mulDiv(executable, 10 ** settlementDecimals, 1e18, false);
            result = proceeds < executable ? proceeds : executable;
        }
        if (result > uint256(type(int256).max)) revert Invalid();
    }
    function positionValue(bytes32 id, address account, uint256 index) public view returns (int256) {
        Config storage value = configs[_bundle(id, account)];
        Position memory item = position(id, account, index);
        Market storage market = _market(value, item.market);
        int256 gross;
        if (value.useCase == UseCase.Perps) {
            uint256 backing = assetValue(market.asset0, item.quantity0, _decimals(value.settlement));
            gross = int256(item.margin < backing ? item.margin : backing) + item.pnl;
        } else {
            uint8 decimals = _decimals(value.settlement);
            gross = int256(assetValue(market.asset0, item.quantity0 + item.rewards0, decimals));
            if (value.useCase == UseCase.Liquidity) gross += int256(assetValue(market.asset1, item.quantity1 + item.rewards1, decimals));
        }
        gross -= int256(item.liability);
        return gross < int256(item.executableValue) ? gross : int256(item.executableValue);
    }
    function requestValue(bytes32 id, address account, uint256 index) public view returns (int256) {
        Config storage value = configs[_bundle(id, account)];
        Request memory item = request(id, account, index);
        Market storage market = _market(value, item.market);
        uint8 decimals = _decimals(value.settlement);
        int256 gross = int256(assetValue(market.asset0, item.quantity0, decimals));
        if (value.useCase == UseCase.Liquidity) gross += int256(assetValue(market.asset1, item.quantity1, decimals));
        gross -= int256(item.liability);
        if (item.claimableAt > core.creditDetails(id).maturity) return gross < 0 ? gross : int256(0);
        return gross < int256(item.executableValue) ? gross : int256(item.executableValue);
    }
    function readAppValue(bytes32 id, address account, address settlement) external view returns (int256 netValue, uint16 retained, uint128 costs, uint256 observedAt) {
        Config storage value = configs[_bundle(id, account)];
        if (settlement != value.settlement) revert Invalid();
        uint8 decimals = _decimals(settlement);
        for (uint256 i; i < value.assets.length; ++i) netValue += int256(assetValue(value.assets[i], _balance(value.assets[i].token, account), decimals));
        Meta memory state = meta(id, account);
        bytes32[32] memory seen;
        for (uint256 i; i < state.positions; ++i) {
            Position memory item = position(id, account, i);
            for (uint256 j; j < i; ++j) if (seen[j] == item.id) revert Invalid();
            seen[i] = item.id;
            netValue += positionValue(id, account, i);
        }
        for (uint256 i; i < state.pending; ++i) { (, ExecutionTypes.PendingState memory item) = order(id, account, i); netValue -= int256(item.maxLiability); }
        bytes32[32] memory pendingSeen;
        for (uint256 i; i < state.pending; ++i) {
            (bytes32 pendingId,) = order(id, account, i);
            for (uint256 j; j < i; ++j) if (pendingSeen[j] == pendingId) revert Invalid();
            pendingSeen[i] = pendingId;
        }
        bytes32[32] memory requestSeen;
        for (uint256 i; i < state.requests; ++i) {
            Request memory item = request(id, account, i);
            for (uint256 j; j < i; ++j) if (requestSeen[j] == item.id) revert Invalid();
            for (uint256 j; j < state.positions; ++j) if (item.replacesPositionId != bytes32(0) && item.replacesPositionId == seen[j]) revert Invalid();
            for (uint256 j; j < state.pending; ++j) if (item.id == pendingSeen[j]) revert Invalid();
            requestSeen[i] = item.id;
            netValue += requestValue(id, account, i);
        }
        return (netValue, value.retainedBps, value.recoveryCosts, block.timestamp);
    }
}
