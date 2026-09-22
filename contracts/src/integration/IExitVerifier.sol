// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IExitVerifier {
    function canExit(bytes32 creditId, address account) external view returns (bool);
}
