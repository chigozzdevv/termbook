// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISettlementInbox {
    function notifyReceipt(uint256 amount) external;
    function notifyAll() external returns (uint256);
    function settle(uint256 amount) external;
    function refund(uint256 amount) external;
    function available() external view returns (uint256);
    function applied() external view returns (uint256);
    function refunded() external view returns (uint256);
}
