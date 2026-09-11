// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library HealthMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_INT = uint256(type(int256).max);

    error Overflow();
    error Factor();

    function applicationValue(uint256 retainedApp, int256 appValue, uint256 factorBps)
        internal
        pure
        returns (int256)
    {
        if (factorBps > BPS || retainedApp > MAX_INT) revert Factor();
        int256 retained = int256(retainedApp);
        int256 value = _applicationPart(appValue, factorBps);
        if (value > 0 && uint256(value) > MAX_INT - retainedApp) revert Overflow();
        return retained + value;
    }

    function applicationValue(int256 appValue, uint256 factorBps) internal pure returns (int256) {
        if (factorBps > BPS) revert Factor();
        return _applicationPart(appValue, factorBps);
    }

    function recoveryValue(
        uint256 cash,
        uint256 sourceValue,
        uint256 sourceFactorBps,
        int256 appValue,
        uint256 appFactorBps,
        uint256 costs
    ) internal pure returns (uint256) {
        if (sourceFactorBps > BPS || appFactorBps > BPS || cash > MAX_INT || costs > MAX_INT) revert Factor();
        int256 value = int256(cash)
            + int256(_haircut(sourceValue, sourceFactorBps))
            + _applicationPart(appValue, appFactorBps)
            - int256(costs);
        return value <= 0 ? 0 : uint256(value);
    }

    function recoveryValue(
        uint256 cash,
        uint256 sourceValue,
        int256 appValue,
        uint256 sourceFactorBps,
        uint256 appFactorBps
    ) internal pure returns (uint256) {
        return recoveryValue(cash, sourceValue, sourceFactorBps, appValue, appFactorBps, 0);
    }

    function _haircut(uint256 value, uint256 factorBps) private pure returns (uint256) {
        if (factorBps == 0 || value == 0) return 0;
        if (value > type(uint256).max / factorBps) revert Overflow();
        uint256 result = value * factorBps / BPS;
        if (result > MAX_INT) revert Overflow();
        return result;
    }

    function _applicationPart(int256 appValue, uint256 factorBps) private pure returns (int256) {
        if (appValue < 0 || factorBps == BPS) return appValue;
        if (appValue == 0 || factorBps == 0) return 0;
        uint256 value = uint256(appValue);
        if (value > MAX_INT / factorBps) revert Overflow();
        return int256(value * factorBps / BPS);
    }

    function healthBps(uint256 recoveryValue_, uint256 debt, uint256 remainingCosts)
        internal
        pure
        returns (uint256)
    {
        if (debt > type(uint256).max - remainingCosts) revert Overflow();
        uint256 denominator = debt + remainingCosts;
        if (denominator == 0) return type(uint256).max;
        if (recoveryValue_ > type(uint256).max / BPS) revert Overflow();
        return recoveryValue_ * BPS / denominator;
    }
}
