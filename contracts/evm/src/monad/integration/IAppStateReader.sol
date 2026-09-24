// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAppStateReader {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);

    function positionCount(bytes32 creditId, address account) external view returns (uint256);

    function positionAt(bytes32 creditId, address account, uint256 index)
        external
        view
        returns (bytes32 positionId, bytes32 marketId);

    function pendingCount(bytes32 creditId, address account) external view returns (uint256);

    /// @dev Remaining liability uses settlement-token base units.
    function pendingAt(bytes32 creditId, address account, uint256 index)
        external
        view
        returns (bytes32 actionId, bytes32 positionId, uint256 remainingLiability, uint256 deadline);
}
