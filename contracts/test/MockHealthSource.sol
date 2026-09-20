// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../src/shared/Types.sol";
import {IHealthSource} from "../src/risk/IHealthSource.sol";

contract MockHealthSource is IHealthSource {
    mapping(bytes32 => Types.HealthSnapshot) internal snapshots;

    function setSnapshot(bytes32 creditId, Types.HealthSnapshot calldata snapshot_) external {
        snapshots[creditId] = snapshot_;
    }

    function snapshot(bytes32 creditId, bytes32, uint256, uint256)
        external
        view
        returns (Types.HealthSnapshot memory)
    {
        return snapshots[creditId];
    }
}
