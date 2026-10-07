// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

import {IAppCallValidator} from "./IAppCallValidator.sol";
import {IAppDeploymentGuard} from "./IAppDeploymentGuard.sol";
import {CodeInspection} from "../../shared/CodeInspection.sol";

contract IntegrationRegistry is ProxyInitializable {
    struct Dependency {
        bytes32 codeHash;
        address guard;
        bytes32 guardCodeHash;
        bool requiresGuard;
        bool shared;
    }

    mapping(bytes32 => mapping(address => Dependency)) public dependencies;
    mapping(bytes32 => address[]) private dependencyList;
    mapping(bytes32 => address[]) private sharedDependencies;
    uint256 public constant MAX_DEPENDENCIES = 64;
    struct Version {
        bytes32 codeHash;
        bool active;
        bool frozen;
    }

    struct CallPolicy {
        bytes32 codeHash;
        uint256 maxDataLength;
        uint8 recipientArg;
        uint8 amountArg;
        uint256 maxAmount;
        address validator;
        bytes32 validatorCodeHash;
        bool active;
    }

    struct RecoveryCallPolicy {
        bytes32 codeHash;
        uint256 maxDataLength;
        uint8 recipientArg;
        address validator;
        bytes32 validatorCodeHash;
        bool active;
    }

    mapping(bytes32 => Version) public versions;
    struct NativeValuePolicy { uint256 maxValue; uint8 amountArg; }
    mapping(bytes32 => mapping(address => mapping(bytes4 => NativeValuePolicy))) public nativeValuePolicies;
    mapping(bytes32 => mapping(address => mapping(bytes4 => NativeValuePolicy))) public recoveryNativeValuePolicies;
    mapping(bytes32 => uint256) public callCount;
    mapping(bytes32 => uint256) public validatedCallCount;
    mapping(bytes32 => uint256) public recoveryCallCount;
    mapping(bytes32 => uint256) public validatedRecoveryCallCount;
    mapping(bytes32 => mapping(address => mapping(bytes4 => bytes32))) public callCodeHashes;
    mapping(bytes32 => mapping(address => mapping(bytes4 => CallPolicy))) public callPolicies;
    mapping(bytes32 => mapping(address => mapping(bytes4 => RecoveryCallPolicy))) public recoveryCallPolicies;
    address public reviewer;
    error Unauthorized();
    error Invalid();
    error Frozen();

    event VersionApproved(bytes32 indexed id, bytes32 codeHash);
    event VersionActivated(bytes32 indexed id);
    event VersionFrozen(bytes32 indexed id);
    event CallRegistered(bytes32 indexed id, address indexed target, bytes4 selector);
    event CallValidatorRegistered(bytes32 indexed id, address indexed target, bytes4 selector, address validator);
    event RecoveryCallRegistered(bytes32 indexed id, address indexed target, bytes4 selector);
    event RecoveryValidatorRegistered(bytes32 indexed id, address indexed target, bytes4 selector, address validator);
    event RecoveryCallDisabled(bytes32 indexed id, address indexed target, bytes4 selector);
    event DependencyPinned(bytes32 indexed id, address indexed dependency, bytes32 codeHash);
    event DependencyGuardSet(bytes32 indexed id, address indexed dependency, address guard);
    event NativeValueRegistered(bytes32 indexed id, address indexed target, bytes4 selector, bool recovery, uint256 maxValue, uint8 amountArg);

    constructor(address reviewer_) {
        if (reviewer_ != address(0)) _initializeIntegrationRegistry(reviewer_);
    }

    function initialize(address reviewer_) external initializer {
        _initializeIntegrationRegistry(reviewer_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.IntegrationRegistry.v1");
    }

    function _initializeIntegrationRegistry(address reviewer_) private {
        reviewer = reviewer_;
    }

    function approve(bytes32 id, bytes32 codeHash) external {
        if (msg.sender != reviewer || id == bytes32(0) || codeHash == bytes32(0)) revert Unauthorized();
        Version storage version = versions[id];
        if (version.frozen) revert Frozen();
        if (version.codeHash != bytes32(0)) revert Invalid();
        version.codeHash = codeHash;
        emit VersionApproved(id, codeHash);
    }

    function activate(bytes32 id) external {
        if (msg.sender != reviewer) revert Unauthorized();
        Version storage version = versions[id];
        if (version.frozen) revert Frozen();
        if (version.codeHash == bytes32(0) || version.active || callCount[id] == 0 || !dependenciesValid(id)
            || validatedCallCount[id] != callCount[id] || validatedRecoveryCallCount[id] != recoveryCallCount[id]) {
            revert Invalid();
        }
        version.active = true;
        emit VersionActivated(id);
    }

    function pinDependency(bytes32 id, address dependency) external {
        if (msg.sender != reviewer || versions[id].active || versions[id].frozen
            || versions[id].codeHash == bytes32(0)) revert Invalid();
        _pinDependency(id, dependency);
        if (!dependencies[id][dependency].shared) {
            dependencies[id][dependency].shared = true;
            sharedDependencies[id].push(dependency);
        }
    }

    function _pinDependency(bytes32 id, address dependency) private {
        if (dependency.code.length == 0) revert Invalid();
        Dependency storage pin = dependencies[id][dependency];
        if (pin.codeHash != bytes32(0)) {
            if (pin.codeHash != dependency.codehash) revert Invalid();
            return;
        }
        if (dependencyList[id].length >= MAX_DEPENDENCIES) revert Invalid();
        pin.codeHash = dependency.codehash;
        pin.requiresGuard = CodeInspection.delegates(dependency);
        dependencyList[id].push(dependency);
        emit DependencyPinned(id, dependency, pin.codeHash);
    }

    function setDependencyGuard(bytes32 id, address dependency, address guard) external {
        if (msg.sender != reviewer || versions[id].active || versions[id].frozen
            || guard.code.length == 0 || CodeInspection.delegates(guard)) revert Invalid();
        Dependency storage pin = dependencies[id][dependency];
        if (pin.codeHash == bytes32(0) || pin.guard != address(0)
            || !IAppDeploymentGuard(guard).valid(dependency)) revert Invalid();
        pin.guard = guard;
        pin.guardCodeHash = guard.codehash;
        emit DependencyGuardSet(id, dependency, guard);
    }

    function dependenciesValid(bytes32 id) public view returns (bool) {
        for (uint256 i; i < dependencyList[id].length; ++i) {
            if (!dependencyValid(id, dependencyList[id][i])) return false;
        }
        return true;
    }

    function dependencyValid(bytes32 id, address dependency) public view returns (bool) {
        Dependency memory pin = dependencies[id][dependency];
        if (pin.codeHash == bytes32(0) || dependency.code.length == 0 || dependency.codehash != pin.codeHash) return false;
        if (pin.guard == address(0)) return !pin.requiresGuard;
        if (pin.guard.codehash != pin.guardCodeHash) return false;
        try IAppDeploymentGuard(pin.guard).valid(dependency) returns (bool valid) { return valid; }
        catch { return false; }
    }

    function _sharedDependenciesValid(bytes32 id) private view returns (bool) {
        for (uint256 i; i < sharedDependencies[id].length; ++i) {
            if (!dependencyValid(id, sharedDependencies[id][i])) return false;
        }
        return true;
    }

    function freeze(bytes32 id) external {
        if (msg.sender != reviewer) revert Unauthorized();
        versions[id].frozen = true;
        versions[id].active = false;
        emit VersionFrozen(id);
    }

    function registerCall(
        bytes32 id,
        address target,
        bytes4 selector,
        uint256 maxDataLength,
        uint8 recipientArg,
        uint8 amountArg,
        uint256 maxAmount
    ) external {
        if (msg.sender != reviewer || target == address(0) || target.code.length == 0 || selector == bytes4(0)) {
            revert Invalid();
        }
        Version memory version = versions[id];
        if (version.frozen) revert Frozen();
        if (version.codeHash == bytes32(0) || version.active || callPolicies[id][target][selector].active) {
            revert Invalid();
        }
        if (maxDataLength < 4 || (amountArg != type(uint8).max && maxAmount == 0)) revert Invalid();
        callCodeHashes[id][target][selector] = target.codehash;
        _pinDependency(id, target);
        callPolicies[id][target][selector] =
            CallPolicy(target.codehash, maxDataLength, recipientArg, amountArg, maxAmount, address(0), bytes32(0), true);
        callCount[id] += 1;
        emit CallRegistered(id, target, selector);
    }

    function setCallValidator(bytes32 id, address target, bytes4 selector, address validator) external {
        if (msg.sender != reviewer || versions[id].active || versions[id].frozen || validator.code.length == 0) {
            revert Invalid();
        }
        CallPolicy storage policy = callPolicies[id][target][selector];
        if (!policy.active || policy.validator != address(0)) revert Invalid();
        policy.validator = validator;
        _pinDependency(id, validator);
        policy.validatorCodeHash = validator.codehash;
        validatedCallCount[id] += 1;
        emit CallValidatorRegistered(id, target, selector, validator);
    }

    function registerRecoveryCall(bytes32 id, address target, bytes4 selector, uint256 maxDataLength, uint8 recipientArg)
        external
    {
        if (msg.sender != reviewer || target.code.length == 0 || selector == bytes4(0) || maxDataLength < 4) {
            revert Invalid();
        }
        Version memory version = versions[id];
        if (version.frozen) revert Frozen();
        if (version.codeHash == bytes32(0) || version.active || recoveryCallPolicies[id][target][selector].active) {
            revert Invalid();
        }
        recoveryCallPolicies[id][target][selector] =
            RecoveryCallPolicy(target.codehash, maxDataLength, recipientArg, address(0), bytes32(0), true);
        _pinDependency(id, target);
        recoveryCallCount[id] += 1;
        emit RecoveryCallRegistered(id, target, selector);
    }

    function setRecoveryCallValidator(bytes32 id, address target, bytes4 selector, address validator) external {
        if (msg.sender != reviewer || versions[id].active || versions[id].frozen || validator.code.length == 0) {
            revert Invalid();
        }
        RecoveryCallPolicy storage policy = recoveryCallPolicies[id][target][selector];
        if (!policy.active || policy.validator != address(0)) revert Invalid();
        policy.validator = validator;
        _pinDependency(id, validator);
        policy.validatorCodeHash = validator.codehash;
        validatedRecoveryCallCount[id] += 1;
        emit RecoveryValidatorRegistered(id, target, selector, validator);
    }

    function disableRecoveryCall(bytes32 id, address target, bytes4 selector) external {
        if (msg.sender != reviewer || !recoveryCallPolicies[id][target][selector].active) revert Invalid();
        if (recoveryCallPolicies[id][target][selector].validator != address(0)) validatedRecoveryCallCount[id] -= 1;
        recoveryCallPolicies[id][target][selector].active = false;
        recoveryCallCount[id] -= 1;
        emit RecoveryCallDisabled(id, target, selector);
    }

    function registerNativeValue(bytes32 id, address target, bytes4 selector, bool recovery, uint256 maxValue, uint8 amountArg)
        external
    {
        if (msg.sender != reviewer || versions[id].active || versions[id].frozen || maxValue == 0
            || (recovery ? !recoveryCallPolicies[id][target][selector].active : !callPolicies[id][target][selector].active)) revert Invalid();
        NativeValuePolicy storage policy = recovery ? recoveryNativeValuePolicies[id][target][selector]
            : nativeValuePolicies[id][target][selector];
        if (policy.maxValue != 0) revert Invalid();
        policy.maxValue = maxValue;
        policy.amountArg = amountArg;
        emit NativeValueRegistered(id, target, selector, recovery, maxValue, amountArg);
    }

    function _validNativeValue(NativeValuePolicy memory policy, bytes calldata data, uint256 value) private pure returns (bool) {
        if (policy.maxValue == 0) return value == 0;
        if (value > policy.maxValue) return false;
        if (policy.amountArg == type(uint8).max) return true;
        uint256 offset = 4 + uint256(policy.amountArg) * 32;
        if (data.length < offset + 32) return false;
        uint256 amount;
        assembly { amount := calldataload(add(data.offset, offset)) }
        return amount == value;
    }

    function validateRecoveryValueCall(bytes32 id, address target, bytes calldata data, address account, uint256 value)
        external view returns (bool)
    {
        return data.length >= 4 && _validNativeValue(recoveryNativeValuePolicies[id][target][bytes4(data[:4])], data, value)
            && validateRecoveryCall(id, target, data, account);
    }

    function validateValueCall(bytes32 id, address target, bytes calldata data, address account, uint256 spendAmount, uint256 value)
        external view returns (bool)
    {
        return data.length >= 4 && _validNativeValue(nativeValuePolicies[id][target][bytes4(data[:4])], data, value)
            && validateCall(id, target, data, account, spendAmount);
    }

    function validateRecoveryCall(bytes32 id, address target, bytes calldata data, address account)
        public
        view
        returns (bool)
    {
        if (data.length < 4) return false;
        Version memory version = versions[id];
        RecoveryCallPolicy memory policy = recoveryCallPolicies[id][target][bytes4(data[:4])];
        if (version.codeHash == bytes32(0) || !_sharedDependenciesValid(id) || !dependencyValid(id, target)
            || !dependencyValid(id, policy.validator) || !policy.active || target.codehash != policy.codeHash
            || data.length > policy.maxDataLength || policy.validator == address(0)
            || policy.validator.codehash != policy.validatorCodeHash) return false;
        if (policy.recipientArg != type(uint8).max) {
            uint256 recipientArg = policy.recipientArg;
            if (data.length < 4 + recipientArg * 32 + 32) return false;
            uint256 recipient;
            assembly {
                recipient := calldataload(add(data.offset, add(4, mul(recipientArg, 32))))
            }
            if (address(uint160(recipient)) != account) return false;
        }
        try IAppCallValidator(policy.validator).validateRecovery(id, target, data, account) returns (bool valid) {
            return valid;
        } catch {
            return false;
        }
    }

    function isCallAllowed(bytes32 id, address target, bytes4 selector) external view returns (bool) {
        Version memory version = versions[id];
        return version.active && !version.frozen && dependenciesValid(id) && callPolicies[id][target][selector].active
            && target.codehash == callCodeHashes[id][target][selector]
            && callPolicies[id][target][selector].validator != address(0)
            && callPolicies[id][target][selector].validator.codehash
                == callPolicies[id][target][selector].validatorCodeHash;
    }

    function isActive(bytes32 id) external view returns (bool) {
        Version memory version = versions[id];
        return version.active && !version.frozen && dependenciesValid(id) && callCount[id] != 0;
    }

    function validateCall(bytes32 id, address target, bytes calldata data, address account, uint256 drawAmount)
        public
        view
        returns (bool)
    {
        if (data.length < 4) return false;
        bytes4 selector = bytes4(data[:4]);
        Version memory version = versions[id];
        CallPolicy memory policy = callPolicies[id][target][selector];
        if (
            !version.active || version.frozen || !dependenciesValid(id) || !policy.active || target.codehash != policy.codeHash
                || data.length > policy.maxDataLength || policy.validator == address(0)
                || policy.validator.codehash != policy.validatorCodeHash
        ) return false;
        if (policy.amountArg == type(uint8).max && policy.maxAmount != 0 && drawAmount > policy.maxAmount) {
            return false;
        }
        if (policy.amountArg != type(uint8).max) {
            uint256 amountArg = policy.amountArg;
            if (data.length < 4 + amountArg * 32 + 32) return false;
            uint256 amount;
            assembly {
                amount := calldataload(add(data.offset, add(4, mul(amountArg, 32))))
            }
            if (amount > policy.maxAmount) return false;
        }
        if (policy.recipientArg != type(uint8).max) {
            uint256 recipientArg = policy.recipientArg;
            if (data.length < 4 + recipientArg * 32 + 32) return false;
            uint256 recipient;
            assembly {
                recipient := calldataload(add(data.offset, add(4, mul(recipientArg, 32))))
            }
            if (address(uint160(recipient)) != account) return false;
        }
        try IAppCallValidator(policy.validator).validateAction(id, target, data, account, drawAmount)
            returns (bool valid)
        {
            return valid;
        } catch {
            return false;
        }
    }

    function callCodeHash(bytes32 id, address target, bytes4 selector) external view returns (bytes32) {
        return callCodeHashes[id][target][selector];
    }
}
