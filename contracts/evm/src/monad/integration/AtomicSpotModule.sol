// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TermbookCore} from "../credit/TermbookCore.sol";
import {AtomicSpotRouter} from "./AtomicSpotRouter.sol";
import {IntegrationRegistry} from "./IntegrationRegistry.sol";
import {ExecutionTypes, IExecutionPolicy} from "./IExecutionPolicy.sol";
import {IAppStateReader} from "./IAppStateReader.sol";
import {IAppValueReader} from "./IAppValueReader.sol";
import {IAppCashReader} from "./IAppCashReader.sol";
import {IAppCallValidator} from "./IAppCallValidator.sol";
import {IAppRecoveryAdapter} from "./IAppRecoveryAdapter.sol";
import {IAppRecoveryFunding} from "./IAppRecoveryFunding.sol";
import {IAppExitPlanner} from "./IAppExitPlanner.sol";
import {IExitVerifier} from "./IExitVerifier.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {FullMath} from "../../shared/FullMath.sol";
import {OracleRegistry} from "../risk/OracleRegistry.sol";

interface ISpotRecoveryQuote {
    function quote(bytes32 program, address market, uint256 amount) external view returns (uint256 sellable, uint256 proceeds);
}

contract AtomicSpotModule is IExecutionPolicy, IAppStateReader, IAppValueReader, IAppCashReader,
    IAppCallValidator, IAppRecoveryAdapter, IAppRecoveryFunding, IAppExitPlanner, IExitVerifier {
    using SafeTransferLib for address;

    struct Market {
        bytes32 marketId;
        bytes32 buyRoute;
        bytes32 sellRoute;
        address quoteSource;
        uint256 maxHolding;
        address oracle;
        bytes32 feedId;
        uint8 baseDecimals;
        uint8 quoteDecimals;
        bytes32 buyCapability;
        bytes32 sellCapability;
        uint256 dustLimit;
        bytes32 quoteProgram;
        uint128 maximumInput;
    }
    struct Config {
        address settlement;
        uint16 retainedBps;
        uint128 recoveryCosts;
        Market[] markets;
    }
    TermbookCore public immutable core;
    AtomicSpotRouter public immutable router;
    IntegrationRegistry public immutable registry;
    address public immutable governance;
    mapping(bytes32 => Config) private configs;
    mapping(bytes32 => bytes32) public configurationHashes;
    bytes4 private constant APPROVE = bytes4(keccak256("approve(address,uint256)"));
    error Invalid();
    error Unauthorized();

    constructor(address governance_, address core_, address router_, address registry_) {
        if (governance_ == address(0) || core_.code.length == 0 || router_.code.length == 0 || registry_.code.length == 0) revert Invalid();
        governance = governance_; core = TermbookCore(core_); router = AtomicSpotRouter(payable(router_));
        registry = IntegrationRegistry(registry_);
    }

    function configure(bytes32 bundle, address settlement, uint16 retainedBps, uint128 costs, Market[] calldata markets) external {
        if (msg.sender != governance) revert Unauthorized();
        if (bundle == bytes32(0) || configurationHashes[bundle] != bytes32(0) || settlement.code.length == 0
            || retainedBps == 0 || retainedBps > 10_000 || markets.length == 0 || markets.length > 16) revert Invalid();
        Config storage config = configs[bundle];
        config.settlement = settlement; config.retainedBps = retainedBps; config.recoveryCosts = costs;
        for (uint256 i; i < markets.length; ++i) {
            Market calldata market = markets[i];
            AtomicSpotRouter.Route memory buy = router.route(market.buyRoute);
            AtomicSpotRouter.Route memory sell = router.route(market.sellRoute);
            if (market.marketId == bytes32(0) || market.quoteSource.code.length == 0 || market.maxHolding == 0
                || market.oracle.code.length == 0 || market.feedId == bytes32(0) || market.baseDecimals > 36 || market.quoteDecimals > 36
                || market.buyCapability == bytes32(0) || market.sellCapability == bytes32(0) || market.buyCapability == market.sellCapability
                || market.maximumInput == 0 || market.quoteProgram == bytes32(0) || market.maxHolding > type(uint128).max || market.dustLimit >= market.maxHolding || buy.bundle != bundle || sell.bundle != bundle
                || buy.input != settlement || sell.output != settlement || buy.output != sell.input
                || buy.target != sell.target || buy.output == settlement) revert Invalid();
            for (uint256 j; j < i; ++j) {
                if (markets[j].marketId == market.marketId || router.route(markets[j].sellRoute).input == sell.input) revert Invalid();
            }
            config.markets.push(market);
            OracleRegistry(market.oracle).read(market.feedId);
        }
        configurationHashes[bundle] = keccak256(abi.encode(settlement, retainedBps, costs, markets));
    }

    function stateReader() external view returns (address) { return address(this); }
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IAppStateReader).interfaceId || id == type(IAppCashReader).interfaceId
            || id == type(IAppRecoveryFunding).interfaceId;
    }
    function _bundle(bytes32 creditId, address account) private view returns (bytes32 bundle) {
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        bundle = credit.bundleId;
        if (credit.account != account || account == address(0) || configurationHashes[bundle] == bytes32(0)) revert Invalid();
    }
    function _balance(address asset, address account) private view returns (uint256) {
        return asset == address(0) ? account.balance : asset.balanceOf(account);
    }
    function _dust(AtomicSpotRouter.Route memory sell, uint256 amount, uint256 limit) private pure returns (bool) {
        return amount <= limit || FullMath.mulDiv(amount, sell.numerator, sell.denominator, false) < sell.minimumSize;
    }
    function positionCount(bytes32 id, address account) public view returns (uint256 count) {
        Config storage config = configs[_bundle(id, account)];
        for (uint256 i; i < config.markets.length; ++i) {
            AtomicSpotRouter.Route memory sell = router.route(config.markets[i].sellRoute);
            if (!_dust(sell, _balance(sell.input, account), config.markets[i].dustLimit)) ++count;
        }
    }
    function positionAt(bytes32 id, address account, uint256 index) external view returns (bytes32, bytes32) {
        Config storage config = configs[_bundle(id, account)];
        uint256 found;
        for (uint256 i; i < config.markets.length; ++i) {
            AtomicSpotRouter.Route memory sell = router.route(config.markets[i].sellRoute);
            if (!_dust(sell, _balance(sell.input, account), config.markets[i].dustLimit) && found++ == index) return (bytes32(uint256(uint160(sell.input))), config.markets[i].marketId);
        }
        revert Invalid();
    }
    function pendingCount(bytes32 id, address account) external view returns (uint256) { _bundle(id, account); return 0; }
    function pendingAt(bytes32, address, uint256) external pure returns (bytes32, bytes32, uint256, uint256) { revert Invalid(); }
    function reservedCash(bytes32 id, address account, address settlement) external view returns (uint256, uint256) {
        if (configs[_bundle(id, account)].settlement != settlement) revert Invalid();
        return (0, block.timestamp);
    }
    function readAppValue(bytes32 id, address account, address settlement) external view returns (int256 value, uint16, uint128, uint256) {
        bytes32 bundle = _bundle(id, account);
        Config storage config = configs[bundle];
        if (settlement != config.settlement || !registry.dependenciesValid(bundle)) revert Invalid();
        for (uint256 i; i < config.markets.length; ++i) {
            Market storage market = config.markets[i];
            AtomicSpotRouter.Route memory sell = router.route(market.sellRoute);
            uint256 balance = _balance(sell.input, account);
            if (!registry.dependencyValid(bundle, market.quoteSource)
                || !registry.dependencyValid(bundle, market.oracle)) revert Invalid();
            if (balance > market.maxHolding) balance = market.maxHolding;
            if (!_dust(sell, balance, market.dustLimit)) {
                (uint256 sellable, uint256 proceeds) = ISpotRecoveryQuote(market.quoteSource).quote(market.quoteProgram, sell.target, balance);
                if (sellable > balance || proceeds > uint256(type(int256).max)) revert Invalid();
                (uint256 price,,) = OracleRegistry(market.oracle).read(market.feedId);
                uint256 fair = FullMath.mulDiv(sellable, price, 10 ** market.baseDecimals, false);
                fair = FullMath.mulDiv(fair, 10 ** market.quoteDecimals, 1e18, false);
                value += int256(proceeds < fair ? proceeds : fair);
            }
        }
        return (value, config.retainedBps, config.recoveryCosts, block.timestamp);
    }
    function _decode(bytes memory data) private pure returns (bytes32 routeId, uint256 amount, uint256 minimum) {
        if (data.length != 100 || bytes4(data) != AtomicSpotRouter.trade.selector) revert Invalid();
        bytes memory args = new bytes(96);
        for (uint256 i; i < 96; ++i) args[i] = data[i + 4];
        return abi.decode(args, (bytes32, uint256, uint256));
    }
    function _market(bytes32 bundle, bytes32 routeId) private view returns (Market memory market, bool buying) {
        Config storage config = configs[bundle];
        for (uint256 i; i < config.markets.length; ++i) {
            market = config.markets[i];
            if (market.buyRoute == routeId) return (market, true);
            if (market.sellRoute == routeId) return (market, false);
        }
        revert Invalid();
    }
    function validateAction(bytes32 bundle, address target, bytes calldata data, address account, uint256 spendAmount) external view returns (bool) {
        if (target != address(router) || data.length != 100 || bytes4(data) != AtomicSpotRouter.trade.selector) return false;
        (bytes32 routeId, uint256 amount, uint256 minimum) = _decode(data);
        _market(bundle, routeId);
        AtomicSpotRouter.Route memory route_ = router.route(routeId);
        return route_.bundle == bundle && account != address(0) && minimum != 0 && amount != 0
            && (route_.input == address(0) ? spendAmount == 0 : spendAmount == amount);
    }
    function prepare(bytes32 id, address account, ExecutionTypes.Action calldata action)
        external view returns (bytes32 beforeState, uint8 slots, uint8 pending, uint256 exposure) {
        bytes32 bundle = _bundle(id, account);
        if (action.calls.length != 1) revert Invalid();
        ExecutionTypes.Call calldata call_ = action.calls[0];
        (bytes32 routeId, uint256 amount, uint256 minimum) = _decode(call_.data);
        (Market memory market, bool buying) = _market(bundle, routeId);
        AtomicSpotRouter.Route memory route_ = router.route(routeId);
        if (action.market != market.marketId || action.capability != (buying ? market.buyCapability : market.sellCapability)
            || core.priceProtection().ruleHashes(keccak256(abi.encode(bundle, action.capability, action.market))) == bytes32(0)
            || buying && amount > market.maximumInput || call_.target != address(router) || minimum == 0
            || call_.spendToken != (route_.input == address(0) ? address(0) : route_.input)
            || (route_.input == address(0) ? call_.nativeValue != amount || call_.spendAmount != 0
                : call_.spendAmount != amount || call_.nativeValue != 0)
            || action.requiredInput != (route_.input == configs[bundle].settlement ? amount : 0)) revert Invalid();
        router.sizedInput(routeId, amount);
        uint256 beforeInput = _balance(route_.input, account);
        uint256 beforeOutput = _balance(route_.output, account);
        if (beforeInput > type(uint128).max || beforeOutput > type(uint128).max || (!buying && beforeInput < amount)) revert Invalid();
        beforeState = bytes32((beforeInput << 128) | beforeOutput);
        slots = buying && _dust(router.route(market.sellRoute), beforeOutput, market.dustLimit) ? 1 : 0;
        pending = 0;
        exposure = action.requiredInput;
    }
    function verifyResult(bytes32 id, address account, ExecutionTypes.Action calldata action, bytes32 beforeState, bytes[] calldata results)
        external view returns (bytes32[] memory) {
        if (results.length != 1 || action.calls.length != 1) revert Invalid();
        (bytes32 routeId, uint256 amount, uint256 minimum) = _decode(action.calls[0].data);
        (Market memory market, bool buying) = _market(_bundle(id, account), routeId);
        AtomicSpotRouter.Route memory route_ = router.route(routeId);
        uint256 beforeInput = uint256(beforeState) >> 128;
        uint256 beforeOutput = uint256(uint128(uint256(beforeState)));
        uint256 afterInput = _balance(route_.input, account);
        uint256 afterOutput = _balance(route_.output, account);
        if ((!buying && (afterInput > beforeInput || beforeInput - afterInput > amount)) || afterOutput < beforeOutput
            || afterOutput - beforeOutput < minimum || buying && afterOutput > market.maxHolding) revert Invalid();
        return new bytes32[](0);
    }
    function pendingState(bytes32, address, bytes32) external pure returns (ExecutionTypes.PendingState memory) { revert Invalid(); }

    function _allowance(address token, address account) private view returns (uint256 value) {
        (bool ok, bytes memory result) = token.staticcall(abi.encodeWithSignature("allowance(address,address)", account, address(router)));
        if (!ok || result.length != 32) revert Invalid();
        return abi.decode(result, (uint256));
    }
    function nextExitStep(bytes32 id, address account) external view returns (bytes32, bytes memory, uint256) {
        bytes32 bundle = _bundle(id, account);
        Config storage config = configs[bundle];
        for (uint256 i; i < config.markets.length; ++i) {
            Market storage market = config.markets[i];
            AtomicSpotRouter.Route memory sell = router.route(market.sellRoute);
            uint256 balance = _balance(sell.input, account);
            uint256 allowance = sell.input == address(0) ? 0 : _allowance(sell.input, account);
            if (_dust(sell, balance, market.dustLimit) && allowance == 0) continue;
            (uint256 amount, uint256 proceeds) = ISpotRecoveryQuote(market.quoteSource).quote(market.quoteProgram, sell.target,
                balance < market.maxHolding ? balance : market.maxHolding);
            if (amount > balance) revert Invalid();
            if (allowance != 0 && (amount == 0 || allowance != amount)) {
                return (keccak256(abi.encode(i, uint8(0), allowance)), abi.encode(uint8(0), i, 0, 0), 0);
            }
            if (amount == 0) {
                if (!_dust(sell, balance, market.dustLimit)) return (bytes32(0), "", block.timestamp + 30);
                continue;
            }
            if (proceeds == 0) return (bytes32(0), "", block.timestamp + 30);
            uint256 minimum = FullMath.mulDiv(proceeds, config.retainedBps, 10_000, false);
            if (minimum == 0) return (bytes32(0), "", block.timestamp + 30);
            return (keccak256(abi.encode(i, uint8(1), amount, minimum)), abi.encode(uint8(1), i, amount, minimum), 0);
        }
        return (bytes32(0), "", 0);
    }
    function recoverySpend(bytes32 id, address account, bytes calldata instruction) external view returns (address token, uint256 amount) {
        Config storage config = configs[_bundle(id, account)];
        (uint8 kind, uint256 index, uint256 specified,) = abi.decode(instruction, (uint8, uint256, uint256, uint256));
        if (instruction.length != 128 || index >= config.markets.length || kind > 1) revert Invalid();
        token = router.route(config.markets[index].sellRoute).input;
        amount = kind == 1 && token != address(0) ? specified : 0;
    }
    function recoveryCall(bytes32 id, address account, bytes calldata instruction)
        external view returns (address target, bytes memory data, uint256 nativeValue, bytes32 expectedState) {
        Config storage config = configs[_bundle(id, account)];
        (uint8 kind, uint256 index, uint256 amount, uint256 minimum) = abi.decode(instruction, (uint8, uint256, uint256, uint256));
        if (instruction.length != 128 || index >= config.markets.length || kind > 1) revert Invalid();
        Market storage market = config.markets[index];
        AtomicSpotRouter.Route memory sell = router.route(market.sellRoute);
        uint256 balance = _balance(sell.input, account);
        if (amount > balance) revert Invalid();
        if (kind == 0) {
            if (sell.input == address(0) || minimum != 0 || amount != 0) revert Invalid();
            target = sell.input; data = abi.encodeWithSelector(APPROVE, address(router), amount);
            expectedState = bytes32(balance);
        } else {
            (uint256 available, uint256 proceeds) = ISpotRecoveryQuote(market.quoteSource).quote(market.quoteProgram, sell.target,
                balance < market.maxHolding ? balance : market.maxHolding);
            uint256 floor = FullMath.mulDiv(proceeds, config.retainedBps, 10_000, false);
            if (amount == 0 || amount != available || minimum == 0 || minimum < floor) revert Invalid();
            target = address(router); data = abi.encodeCall(router.trade, (market.sellRoute, amount, minimum));
            nativeValue = sell.input == address(0) ? amount : 0;
            uint256 cash = _balance(config.settlement, account);
            if (balance > type(uint128).max || cash > type(uint128).max) revert Invalid();
            expectedState = bytes32((balance << 128) | cash);
        }
    }
    function verifyRecovery(bytes32 id, address account, bytes calldata instruction, bytes32 expected) external view returns (bool) {
        Config storage config = configs[_bundle(id, account)];
        (uint8 kind, uint256 index, uint256 amount, uint256 minimum) = abi.decode(instruction, (uint8, uint256, uint256, uint256));
        if (index >= config.markets.length) return false;
        address asset = router.route(config.markets[index].sellRoute).input;
        if (kind == 0) return asset != address(0) && _allowance(asset, account) == amount && _balance(asset, account) == uint256(expected);
        uint256 beforeBalance = uint256(expected) >> 128;
        uint256 beforeCash = uint128(uint256(expected));
        uint256 balance = _balance(asset, account);
        uint256 cash = _balance(config.settlement, account);
        return kind == 1 && balance <= beforeBalance && beforeBalance - balance <= amount
            && balance < beforeBalance && cash >= beforeCash && cash - beforeCash >= minimum;
    }
    function validateRecovery(bytes32 bundle, address target, bytes calldata data, address account) external view returns (bool) {
        Config storage config = configs[bundle];
        if (data.length == 68 && bytes4(data) == APPROVE) {
            (address spender, uint256 approvedAmount) = abi.decode(data[4:], (address, uint256));
            if (spender != address(router)) return false;
            for (uint256 i; i < config.markets.length; ++i) {
                address approvedAsset = router.route(config.markets[i].sellRoute).input;
                if (approvedAsset == target && approvedAsset != address(0)) return approvedAmount == 0;
            }
        }
        if (target != address(router) || data.length != 100 || bytes4(data) != AtomicSpotRouter.trade.selector) return false;
        (bytes32 routeId, uint256 amount, uint256 minimum) = _decode(data);
        (Market memory market, bool buying) = _market(bundle, routeId);
        address asset = router.route(market.sellRoute).input;
        return !buying && amount != 0 && amount <= _balance(asset, account) && minimum != 0;
    }
    function canExit(bytes32 id, address account) external view returns (bool) {
        Config storage config = configs[_bundle(id, account)];
        for (uint256 i; i < config.markets.length; ++i) {
            AtomicSpotRouter.Route memory sell = router.route(config.markets[i].sellRoute);
            if (!_dust(sell, _balance(sell.input, account), config.markets[i].dustLimit) || sell.input != address(0) && _allowance(sell.input, account) != 0) return false;
        }
        return true;
    }
}
