// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHouseVault {
    function deposit(address to, uint256 amount) external returns (uint256);
    function requestWithdraw(uint256 shares) external returns (uint256);
    function requestWithdrawTo(uint256 shares, address to) external returns (uint256);
    function requestWithdrawQueued(uint256 shares, address to) external returns (uint256, uint256);
    function claimWithdrawal(uint256 withdrawalId) external returns (uint256);
    function cancelWithdrawal(uint256 withdrawalId) external returns (uint256);
    function fundDraw(address account, uint256 amount) external;
    function receiveRepay(uint256 amount) external;
    function receiveRepay(
        bytes32 creditId,
        uint256 amount,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 feePaid
    ) external;
    function setProtocolFee(address recipient, uint256 feeBps) external;
    function recordAccruedReceivable(bytes32 creditId, uint256 amount) external;
    function restoreCommitment(bytes32 creditId, uint256 amount) external;
    function sharePrice() external view returns (uint256);
}
