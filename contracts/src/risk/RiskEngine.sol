// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../shared/Types.sol";
import {HealthMath} from "./HealthMath.sol";
import {IRiskEngine} from "./IRiskEngine.sol";

contract RiskEngine is IRiskEngine {
    uint256 public protocolFloorBps = 11_000;
    mapping(bytes32 => Types.HealthSnapshot) internal _snaps;
    mapping(bytes32 => uint256) public initialBps;
    mapping(bytes32 => uint256) public maintenanceBps;
    mapping(bytes32 => uint256) public watchBps;
    mapping(bytes32 => uint256) public freezeBps;
    mapping(bytes32 => uint256) public liquidationBps;
    address public immutable core;

    error Unauthorized();
    error BadOrder();
    error BelowFloor();
    error BadSnapshot();
    error Frozen();
    error NoWithdraw();
    error Unconfigured();

    constructor(address core_) {
        core = core_;
    }

    function setThresholds(bytes32 creditId, uint256 initial_, uint256 maintenance_, uint256 liquidation_) external {
        if (msg.sender != core) revert Unauthorized();
        if (liquidation_ < protocolFloorBps) revert("below-floor");
        if (initial_ < maintenance_ || maintenance_ <= liquidation_) revert BadOrder();
        uint256 freeze_ = liquidation_ + 1;
        uint256 watch_ = maintenance_ - 1;
        if (watch_ < freeze_) watch_ = freeze_;
        initialBps[creditId] = initial_;
        maintenanceBps[creditId] = maintenance_;
        watchBps[creditId] = watch_;
        freezeBps[creditId] = freeze_;
        liquidationBps[creditId] = liquidation_;
    }

    function setRiskBands(
        bytes32 creditId,
        uint256 initial_,
        uint256 maintenance_,
        uint256 watch_,
        uint256 freeze_,
        uint256 liquidation_
    ) external {
        if (msg.sender != core) revert Unauthorized();
        if (liquidation_ < protocolFloorBps) revert BelowFloor();
        if (!(initial_ >= maintenance_ && maintenance_ > watch_ && watch_ >= freeze_ && freeze_ >= liquidation_)) {
            revert BadOrder();
        }
        initialBps[creditId] = initial_;
        maintenanceBps[creditId] = maintenance_;
        watchBps[creditId] = watch_;
        freezeBps[creditId] = freeze_;
        liquidationBps[creditId] = liquidation_;
    }

    function record(bytes32 creditId, Types.HealthSnapshot calldata snap) external {
        if (msg.sender != core) revert Unauthorized();
        if (snap.retainedSource > 10_000 || snap.retainedApp > 10_000) revert BadSnapshot();
        if (snap.debt > 0) {
            uint256 expectedRecovery = HealthMath.recoveryValue(
                snap.cash,
                snap.sourceValue,
                snap.retainedSource,
                snap.appValue,
                snap.retainedApp,
                snap.recoveryCosts
            );
            if (snap.recoveryValue != expectedRecovery || snap.healthBps != HealthMath.healthBps(expectedRecovery, snap.debt, snap.recoveryCosts)) revert BadSnapshot();
        }
        _snaps[creditId] = snap;
    }

    function snapshot(bytes32 creditId) external view returns (Types.HealthSnapshot memory) {
        return _snaps[creditId];
    }

    function health(bytes32 creditId) public view returns (uint256) {
        Types.HealthSnapshot memory s = _snaps[creditId];
        return HealthMath.healthBps(s.recoveryValue, s.debt, s.recoveryCosts);
    }

    function riskState(bytes32 creditId) public view returns (Types.Risk) {
        Types.HealthSnapshot memory s = _snaps[creditId];
        if (s.debt == 0) return Types.Risk.Healthy;
        uint256 h = health(creditId);
        if (h <= liquidationBps[creditId]) return Types.Risk.Liquidatable;
        if (h <= freezeBps[creditId]) return Types.Risk.Frozen;
        if (h <= watchBps[creditId]) return Types.Risk.Watch;
        return Types.Risk.Healthy;
    }

    function checkDraw(bytes32 creditId, uint256 newDebt) external view {
        if (initialBps[creditId] == 0 || liquidationBps[creditId] == 0) revert Unconfigured();
        Types.HealthSnapshot memory s = _snaps[creditId];
        if (newDebt == 0) return;
        uint256 h = HealthMath.healthBps(s.recoveryValue, newDebt, s.recoveryCosts);
        if (h < initialBps[creditId] || h <= liquidationBps[creditId]) revert Frozen();
    }

    function checkWithdraw(bytes32 creditId, uint256 cashAfter) external view {
        if (maintenanceBps[creditId] == 0 || liquidationBps[creditId] == 0) revert Unconfigured();
        Types.HealthSnapshot memory s = _snaps[creditId];
        uint256 recovery = s.recoveryValue;
        if (cashAfter >= s.cash) recovery += cashAfter - s.cash;
        else recovery -= s.cash - cashAfter > recovery ? recovery : s.cash - cashAfter;
        uint256 h = HealthMath.healthBps(recovery, s.debt, s.recoveryCosts);
        if (h <= maintenanceBps[creditId]) revert NoWithdraw();
    }

    function applyCashWithdraw(bytes32 creditId, uint256 cashAfter) external {
        if (msg.sender != core) revert Unauthorized();
        Types.HealthSnapshot memory s = _snaps[creditId];
        if (cashAfter > s.cash) revert BadSnapshot();
        s.cash = cashAfter;
        s.recoveryValue = HealthMath.recoveryValue(s.cash, s.sourceValue, s.retainedSource, s.appValue, s.retainedApp, s.recoveryCosts);
        s.healthBps = HealthMath.healthBps(s.recoveryValue, s.debt, s.recoveryCosts);
        _snaps[creditId] = s;
    }

    function checkCollateralWithdraw(bytes32 creditId, uint256 sourceValueAfter) external view {
        if (msg.sender != core) revert Unauthorized();
        Types.HealthSnapshot memory s = _snaps[creditId];
        if (sourceValueAfter > s.sourceValue) revert BadSnapshot();
        if (s.debt == 0) return;
        if (maintenanceBps[creditId] == 0 || liquidationBps[creditId] == 0) revert Unconfigured();
        uint256 sourceLoss = s.sourceValue - sourceValueAfter;
        uint256 recoveryLoss = sourceLoss * s.retainedSource / 10_000;
        uint256 recoveryAfter = recoveryLoss >= s.recoveryValue ? 0 : s.recoveryValue - recoveryLoss;
        uint256 h = HealthMath.healthBps(recoveryAfter, s.debt, s.recoveryCosts);
        if (h <= maintenanceBps[creditId]) revert NoWithdraw();
    }

    function applyCollateralWithdraw(bytes32 creditId, uint256 sourceValueAfter) external {
        if (msg.sender != core) revert Unauthorized();
        Types.HealthSnapshot memory s = _snaps[creditId];
        if (sourceValueAfter > s.sourceValue) revert BadSnapshot();
        s.sourceValue = sourceValueAfter;
        s.recoveryValue = HealthMath.recoveryValue(s.cash, sourceValueAfter, s.retainedSource, s.appValue, s.retainedApp, s.recoveryCosts);
        s.healthBps = HealthMath.healthBps(s.recoveryValue, s.debt, s.recoveryCosts);
        _snaps[creditId] = s;
    }
}
