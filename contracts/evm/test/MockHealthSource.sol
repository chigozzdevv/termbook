// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../src/shared/Types.sol";
import {IHealthSource} from "../src/monad/risk/IHealthSource.sol";
import {HealthMath} from "../src/monad/risk/HealthMath.sol";

contract MockHealthSource is IHealthSource {
    mapping(bytes32 => Types.HealthSnapshot) internal snapshots;
    mapping(bytes32 => bool) public readerActive;
    mapping(bytes32 => uint256) public observedAt;
    error Stale();

    function setReaderActive(bytes32 bundleId, bool active) external {
        readerActive[bundleId] = active;
    }

    function isReaderActive(bytes32 bundleId) external view returns (bool) {
        return readerActive[bundleId];
    }

    function setSnapshot(bytes32 creditId, Types.HealthSnapshot calldata snapshot_) external {
        snapshots[creditId] = snapshot_;
        observedAt[creditId] = block.timestamp;
    }

    function snapshot(bytes32 creditId, bytes32, uint256, uint256 debt)
        external
        view
        returns (Types.HealthSnapshot memory)
    {
        if (observedAt[creditId] == 0 || block.timestamp > observedAt[creditId] + 1 days) revert Stale();
        Types.HealthSnapshot memory result = snapshots[creditId];
        result.debt = debt;
        result.healthBps = HealthMath.healthBps(result.recoveryValue, debt, result.recoveryCosts);
        return result;
    }

    function freeCash(bytes32 creditId, bytes32, uint256) external view returns (uint256) {
        return snapshots[creditId].cash;
    }
}
