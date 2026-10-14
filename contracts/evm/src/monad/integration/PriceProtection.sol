// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

import {ExecutionTypes} from "./IExecutionPolicy.sol";
import {OracleRegistry} from "../risk/OracleRegistry.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";
import {IAppDeploymentGuard} from "./IAppDeploymentGuard.sol";
import {FullMath} from "../../shared/FullMath.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {IntegrationRegistry} from "./IntegrationRegistry.sol";

interface IPriceToken { function decimals() external view returns (uint8); }
interface IPriceCore { function integrationRegistry() external view returns (address); }

contract PriceProtection is ProxyInitializable {
    struct Rule {
        address oracle;
        bytes32 feedId;
        address target;
        bytes4 selector;
        uint8 callIndex;
        uint8 priceDecimals;
        uint16 priceWord;
        uint16 directionWord;
        uint16 maxSlippageBps;
        uint16 maxDeviationBps;
        uint32 maxAuthorizationAge;
        uint256 maximumDirection;
        uint256 minimumDirection;
    }
    struct Quote {
        uint80 roundId;
        uint256 referencePrice;
        uint256 updatedAt;
        uint256 authorizedAt;
        uint256 bound;
        uint16 slippageBps;
        bool isMax;
    }
    struct AmountRule {
        uint16 amountWord;
        uint8 inputDecimals;
        uint8 outputDecimals;
        bool inverse;
        bool maxInput;
        bool active;
        address inputAsset;
        address outputAsset;
    }
    address public core;
    mapping(bytes32 => Rule) private rules;
    mapping(bytes32 => AmountRule) public amountRules;
    mapping(bytes32 => bytes32) public ruleHashes;
    mapping(bytes32 => bytes32) public oracleCodeHashes;
    mapping(bytes32 => bool) public bundleSealed;
    mapping(bytes32 => uint16) public houseSlippage;
    mapping(bytes32 => bool) public creditBound;
    mapping(bytes32 => address) public oracleDependencyRegistries;
    struct Reference { uint256 value; uint256 updatedAt; uint256 recordedAt; uint256 observedAt; }
    mapping(bytes32 => mapping(uint80 => Reference)) private references;
    mapping(bytes32 => uint80) private referenceRounds;
    error Unauthorized();
    error Invalid();
    error Stale();
    event RuleConfigured(bytes32 indexed bundleId, bytes32 indexed capability, bytes32 indexed market, bytes32 ruleHash);
    event PriceRecorded(bytes32 indexed ruleId, uint80 indexed roundId, uint256 value, uint256 updatedAt);
    constructor(address core_) {
        if (core_ != address(0)) _initializePriceProtection(core_);
    }

    function initialize(address core_) external initializer {
        _initializePriceProtection(core_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.PriceProtection.v1");
    }

    function _initializePriceProtection(address core_) private { if (core_ == address(0)) revert Invalid(); core = core_; }
    modifier onlyCore() { if (msg.sender != core) revert Unauthorized(); _; }

    function key(bytes32 bundle, bytes32 capability, bytes32 market) public pure returns (bytes32) {
        return keccak256(abi.encode(bundle, capability, market));
    }
    function rule(bytes32 bundle, bytes32 capability, bytes32 market) external view returns (Rule memory) {
        return rules[key(bundle, capability, market)];
    }
    function configure(bytes32 bundle, bytes32 capability, bytes32 market, Rule calldata value) external onlyCore {
        address dependencies = CodeInspection.delegates(value.oracle) ? IPriceCore(core).integrationRegistry() : address(0);
        _configure(bundle, capability, market, value, false, dependencies);
    }
    function configureAmountRule(bytes32 bundle, bytes32 capability, bytes32 market, Rule calldata value, AmountRule calldata amount, address integrationRegistry)
        external onlyCore {
        if (!amount.active || amount.amountWord > 511 || amount.amountWord == value.priceWord
            || amount.inputDecimals > 36 || amount.outputDecimals > 36 || amount.inputAsset == amount.outputAsset
            || _decimals(amount.inputAsset) != amount.inputDecimals || _decimals(amount.outputAsset) != amount.outputDecimals) revert Invalid();
        if (integrationRegistry != address(0)
            && ((amount.inputAsset != address(0) && !IntegrationRegistry(integrationRegistry).dependencyValid(bundle, amount.inputAsset))
                || (amount.outputAsset != address(0) && !IntegrationRegistry(integrationRegistry).dependencyValid(bundle, amount.outputAsset)))) revert Invalid();
        _configure(bundle, capability, market, value, true, integrationRegistry);
        bytes32 id = key(bundle, capability, market);
        amountRules[id] = amount;
        ruleHashes[id] = keccak256(abi.encode(ruleHashes[id], amount));
        emit RuleConfigured(bundle, capability, market, ruleHashes[id]);
    }
    function _configure(bytes32 bundle, bytes32 capability, bytes32 market, Rule calldata value, bool amountBound, address dependencies) private {
        bytes32 id = key(bundle, capability, market);
        if (bundle == bytes32(0) || capability == bytes32(0) || bundleSealed[bundle] || ruleHashes[id] != bytes32(0)
            || value.oracle.code.length == 0
            || value.target.code.length == 0 || value.selector == bytes4(0) || value.feedId == bytes32(0)
            || value.callIndex >= 8 || value.priceDecimals > 36 || value.priceWord > 511
            || (!amountBound && (value.directionWord > 511 || value.priceWord == value.directionWord
                || value.maximumDirection == value.minimumDirection))
            || value.maxSlippageBps > 5_000 || value.maxDeviationBps == 0 || value.maxDeviationBps > 5_000
            || value.maxAuthorizationAge == 0 || value.maxAuthorizationAge > 15 minutes) revert Invalid();
        if (CodeInspection.delegates(value.oracle)) {
            if (dependencies.code.length == 0 || !IntegrationRegistry(dependencies).dependencyValid(bundle, value.oracle)) revert Invalid();
            oracleDependencyRegistries[id] = dependencies;
        }
        OracleRegistry registry = OracleRegistry(value.oracle);
        address feed = registry.feeds(value.feedId);
        address guard = registry.feedGuards(value.feedId);
        if (feed.code.length == 0 || guard.code.length == 0 || !IAppDeploymentGuard(guard).valid(feed)) revert Invalid();
        registry.read(value.feedId);
        rules[id] = value;
        oracleCodeHashes[id] = value.oracle.codehash;
        ruleHashes[id] = keccak256(abi.encode(block.chainid, address(this), bundle, capability, market, value, value.oracle.codehash));
        emit RuleConfigured(bundle, capability, market, ruleHashes[id]);
    }
    function bindCredit(bytes32 creditId, bytes32 bundle, uint16 maxSlippage) external onlyCore {
        if (creditBound[creditId] || maxSlippage > 5_000) revert Invalid();
        creditBound[creditId] = true;
        houseSlippage[creditId] = maxSlippage;
        bundleSealed[bundle] = true;
    }
    function referenceVersion() external pure returns (uint256) { return 2; }
    function currentPriceReference(bytes32 bundle, bytes32 capability, bytes32 market)
        external view returns (uint256 price, uint256 updatedAt, uint80 round, uint256 observedAt) {
        bytes32 id = key(bundle, capability, market);
        Rule memory value = rules[id];
        _requireOracle(id, bundle, value);
        (price, updatedAt,) = OracleRegistry(value.oracle).read(value.feedId);
        return (price, updatedAt, 0, block.timestamp);
    }
    function recordPrice(bytes32 bundle, bytes32 capability, bytes32 market) external {
        bytes32 id = key(bundle, capability, market);
        Rule memory value = rules[id];
        _requireOracle(id, bundle, value);
        (uint256 price, uint256 updated, uint80 round) = OracleRegistry(value.oracle).read(value.feedId);
        Reference storage recorded = references[id][round];
        if (recorded.recordedAt == 0) {
            recorded.value = price; recorded.updatedAt = updated; recorded.recordedAt = block.timestamp;
        } else if (recorded.value != price || recorded.updatedAt != updated) revert Invalid();
        recorded.observedAt = block.timestamp;
        referenceRounds[id] = round;
        emit PriceRecorded(id, round, price, updated);
    }
    function priceReference(bytes32 bundle, bytes32 capability, bytes32 market)
        external view returns (uint256 price, uint256 updatedAt, uint80 round, uint256 observedAt) {
        bytes32 id = key(bundle, capability, market);
        Rule memory value = rules[id];
        _requireOracle(id, bundle, value);
        round = referenceRounds[id];
        Reference memory recorded = references[id][round];
        if (recorded.recordedAt == 0 || block.timestamp - recorded.observedAt > value.maxAuthorizationAge) revert Stale();
        (uint256 current,,) = OracleRegistry(value.oracle).read(value.feedId);
        _requireDeviation(recorded.value, current, value.maxDeviationBps);
        return (recorded.value, recorded.updatedAt, round, recorded.observedAt);
    }
    function _requireOracle(bytes32 id, bytes32 bundle, Rule memory value) private view {
        if (value.oracle == address(0) || value.oracle.codehash != oracleCodeHashes[id]
            || (oracleDependencyRegistries[id] != address(0)
                && !IntegrationRegistry(oracleDependencyRegistries[id]).dependencyValid(bundle, value.oracle))) revert Invalid();
    }
    function _requireDeviation(uint256 referencePrice, uint256 current, uint16 maxDeviation) private pure {
        uint256 difference = current > referencePrice ? current - referencePrice : referencePrice - current;
        if (difference > FullMath.mulDiv(referencePrice, maxDeviation, 10_000, false)) revert Stale();
    }
    function validate(bytes32 creditId, bytes32 bundle, ExecutionTypes.Action calldata action, Quote calldata quote)
        external view {
        bytes32 id = key(bundle, action.capability, action.market);
        Rule memory value = rules[id];
        if (value.oracle == address(0)) {
            if (keccak256(abi.encode(quote)) != keccak256(abi.encode(Quote(0, 0, 0, 0, 0, 0, false)))) revert Invalid();
            return;
        }
        if (!creditBound[creditId] || value.oracle.codehash != oracleCodeHashes[id]
            || (oracleDependencyRegistries[id] != address(0)
                && !IntegrationRegistry(oracleDependencyRegistries[id]).dependencyValid(bundle, value.oracle))
            || quote.slippageBps > value.maxSlippageBps || quote.slippageBps > houseSlippage[creditId]
            || quote.authorizedAt > block.timestamp
            || (quote.roundId != 0 && block.timestamp - quote.authorizedAt > value.maxAuthorizationAge)
            || quote.updatedAt > quote.authorizedAt || action.calls.length <= value.callIndex) revert Invalid();
        OracleRegistry registry = OracleRegistry(value.oracle);
        (uint256 current,,) = registry.read(value.feedId);
        uint256 refPrice;
        uint256 updated;
        Reference memory recorded = references[id][quote.roundId];
        if (quote.roundId == 0) {
            if (quote.referencePrice == 0 || quote.updatedAt == 0 || quote.authorizedAt == 0) revert Invalid();
            refPrice = quote.referencePrice; updated = quote.updatedAt;
        } else if (recorded.recordedAt != 0 && recorded.recordedAt <= quote.authorizedAt
            && block.timestamp - recorded.observedAt <= uint256(value.maxAuthorizationAge) * 2) {
            refPrice = recorded.value; updated = recorded.updatedAt;
        } else {
            (refPrice, updated,) = registry.readRound(value.feedId, quote.roundId);
        }
        if (refPrice != quote.referencePrice || updated != quote.updatedAt) revert Stale();
        _requireDeviation(refPrice, current, value.maxDeviationBps);
        ExecutionTypes.Call calldata call_ = action.calls[value.callIndex];
        if (call_.target != value.target || bytes4(call_.data) != value.selector
            || _word(call_.data, value.priceWord) != quote.bound) revert Invalid();
        AmountRule memory amount = amountRules[id];
        uint16 currentSlippage = value.maxSlippageBps < houseSlippage[creditId] ? value.maxSlippageBps : houseSlippage[creditId];
        if (amount.active) {
            if (_decimals(amount.inputAsset) != amount.inputDecimals || _decimals(amount.outputAsset) != amount.outputDecimals) revert Invalid();
            uint256 specified = _word(call_.data, amount.amountWord);
            uint256 inputLimit = amount.maxInput ? quote.bound : specified;
            if (amount.inputAsset == address(0) ? call_.nativeValue > inputLimit
                : call_.spendToken != amount.inputAsset || call_.spendAmount > inputLimit) revert Invalid();
            if (quote.isMax != amount.maxInput || quote.bound != deriveAmountBound(refPrice,
                specified, quote.slippageBps, amount.inputDecimals,
                amount.outputDecimals, amount.inverse, amount.maxInput)) revert Invalid();
            if (quote.roundId == 0) {
                uint256 currentBound = deriveAmountBound(current, specified, currentSlippage, amount.inputDecimals,
                    amount.outputDecimals, amount.inverse, amount.maxInput);
                if (quote.isMax ? quote.bound > currentBound : quote.bound < currentBound) revert Stale();
            }
        } else {
            uint256 approved = deriveBound(refPrice, quote.slippageBps, quote.isMax, value.priceDecimals);
            if (quote.bound == 0 || (quote.isMax ? quote.bound > approved : quote.bound < approved)
                || _word(call_.data, value.directionWord) != (quote.isMax ? value.maximumDirection : value.minimumDirection)) revert Invalid();
            if (quote.roundId == 0) {
                uint256 currentBound = deriveBound(current, currentSlippage, quote.isMax, value.priceDecimals);
                if (quote.isMax ? quote.bound > currentBound : quote.bound < currentBound) revert Stale();
            }
        }
    }
    function validFunding(ExecutionTypes.Action calldata action, address settlementAsset) external pure returns (bool) {
        uint256 required;
        for (uint256 i; i < action.calls.length; ++i) {
            if (action.calls[i].spendToken == settlementAsset) required += action.calls[i].spendAmount;
        }
        return required == action.requiredInput;
    }
    function captureBalances(bytes32 bundle, ExecutionTypes.Action calldata action, address account, uint256 callIndex)
        external view returns (uint256 inputBalance, uint256 outputBalance) {
        bytes32 id = key(bundle, action.capability, action.market);
        AmountRule memory amount = amountRules[id];
        if (!amount.active || rules[id].callIndex != callIndex) return (0, 0);
        return (_balance(amount.inputAsset, account), _balance(amount.outputAsset, account));
    }
    function validateAmountResult(bytes32 bundle, ExecutionTypes.Action calldata action, address account, uint256 callIndex,
        uint256 beforeInput, uint256 beforeOutput) external view {
        bytes32 id = key(bundle, action.capability, action.market);
        AmountRule memory amount = amountRules[id];
        if (!amount.active || rules[id].callIndex != callIndex) return;
        Rule memory value = rules[id];
        uint256 specified = _word(action.calls[callIndex].data, amount.amountWord);
        uint256 bound = _word(action.calls[callIndex].data, value.priceWord);
        uint256 afterInput = _balance(amount.inputAsset, account);
        uint256 afterOutput = _balance(amount.outputAsset, account);
        if (afterOutput < beforeOutput || afterOutput - beforeOutput < (amount.maxInput ? specified : bound)
            || (beforeInput > afterInput && beforeInput - afterInput > (amount.maxInput ? bound : specified))) revert Invalid();
    }
    function _balance(address token, address account) private view returns (uint256) {
        return token == address(0) ? account.balance : SafeTransferLib.balanceOf(token, account);
    }
    function _decimals(address token) private view returns (uint8) {
        if (token == address(0)) return 18;
        if (token.code.length == 0) revert Invalid();
        return IPriceToken(token).decimals();
    }
    function deriveAmountBound(uint256 refPrice, uint256 amount, uint16 bps, uint8 inputDecimals,
        uint8 outputDecimals, bool inverse, bool maxInput) public pure returns (uint256) {
        if (refPrice == 0 || amount == 0 || bps > 5_000 || inputDecimals > 36 || outputDecimals > 36) revert Invalid();
        if (maxInput) {
            (inputDecimals, outputDecimals) = (outputDecimals, inputDecimals);
            inverse = !inverse;
        }
        uint256 numerator = inverse ? 1e18 : refPrice;
        uint256 denominator = inverse ? refPrice : 1e18;
        if (outputDecimals > inputDecimals) numerator *= 10 ** (outputDecimals - inputDecimals);
        else denominator *= 10 ** (inputDecimals - outputDecimals);
        uint256 fair = FullMath.mulDiv(amount, numerator, denominator, !maxInput);
        uint256 result = FullMath.mulDiv(fair, maxInput ? 10_000 + uint256(bps) : 10_000 - uint256(bps), 10_000, !maxInput);
        if (result == 0) revert Invalid();
        return result;
    }
    function deriveBound(uint256 refPrice, uint16 bps, bool isMax, uint8 decimals) public pure returns (uint256) {
        if (refPrice == 0 || bps > 5_000 || decimals > 36) revert Invalid();
        uint256 factor = isMax ? 10_000 + uint256(bps) : 10_000 - uint256(bps);
        uint256 numerator = refPrice * factor;
        uint256 denominator = 10_000;
        if (decimals < 18) denominator *= 10 ** (18 - decimals);
        else if (decimals > 18) numerator *= 10 ** (decimals - 18);
        uint256 result = isMax ? numerator / denominator : (numerator - 1) / denominator + 1;
        if (result == 0) revert Invalid();
        return result;
    }
    function _word(bytes calldata data, uint256 index) private pure returns (uint256 result) {
        uint256 offset = 4 + index * 32;
        if (data.length < offset + 32) revert Invalid();
        assembly { result := calldataload(add(data.offset, offset)) }
    }
}
