// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../src/shared/Types.sol";
import {IHealthSource} from "../src/monad/risk/IHealthSource.sol";
import {HealthMath} from "../src/monad/risk/HealthMath.sol";

contract MockHealthSource is IHealthSource {
    mapping(bytes32 => Types.HealthSnapshot) internal snapshots;

    function setSnapshot(bytes32 creditId, Types.HealthSnapshot calldata snapshot_) external {
        snapshots[creditId] = snapshot_;
    }

    function snapshot(bytes32 creditId, bytes32, uint256, uint256 debt)
        external
        view
        returns (Types.HealthSnapshot memory)
    {
        Types.HealthSnapshot memory result = snapshots[creditId];
        result.debt = debt;
        result.healthBps = HealthMath.healthBps(result.recoveryValue, debt, result.recoveryCosts);
        return result;
    }
}
