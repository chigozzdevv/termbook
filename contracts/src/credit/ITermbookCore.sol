// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../shared/Types.sol";

interface ITermbookCore {
    function creditFacility(bytes32 creditId) external view returns (Types.Facility);
    function creditDebt(bytes32 creditId) external view returns (uint256);
    function creditRevision(bytes32 creditId) external view returns (uint256);
    function isReady(bytes32 creditId) external view returns (bool);
    function creditAccount(bytes32 creditId) external view returns (address);
    function healthSnapshot(bytes32 creditId) external view returns (Types.HealthSnapshot memory);
}
