// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppRetentionVerifier {
    function canRetain(bytes32 creditId, address account, address borrower) external view returns (bool);
}

interface IAppRetentionReader {
    /// @dev All retained obligations must stay isolated from House assets after ownership release.
    function retentionState(bytes32 creditId, address account, address borrower)
        external view returns (bool accountOwned, bool authorityExtinguished, bool obligationsIsolated, uint256 observedAt);
}

interface IAppRetentionPlanner {
    /// @dev Steps may cancel pending actions, settle isolated obligations, or migrate ownership without selling positions.
    function nextRetentionStep(bytes32 creditId, address account, address borrower)
        external view returns (bytes32 stepId, address target, bytes memory data, bytes32 expectedState, uint256 retryAt);
    function verifyRetentionStep(bytes32 creditId, address account, address borrower, bytes32 expectedState)
        external view returns (bool);
}
