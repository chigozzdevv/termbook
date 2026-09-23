// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../../shared/Types.sol";

interface IRiskEngine {
    function snapshot(bytes32 creditId) external view returns (Types.HealthSnapshot memory);
    function riskState(bytes32 creditId) external view returns (Types.Risk);
    function checkDraw(bytes32 creditId, uint256 newDebt) external view;
    function checkWithdraw(bytes32 creditId, uint256 cashAfter) external view;
    function applyCashWithdraw(bytes32 creditId, uint256 cashAfter) external;
    function checkCollateralWithdraw(bytes32 creditId, uint256 sourceValueAfter) external view;
    function applyCollateralWithdraw(bytes32 creditId, uint256 sourceValueAfter) external;
}
