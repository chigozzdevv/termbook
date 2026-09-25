// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library WormholeTermbookMessages {
    bytes32 internal constant AUTH = keccak256("Termbook Wormhole authorization v1");
    bytes32 internal constant SNAPSHOT = keccak256("Termbook Wormhole Ethereum snapshot v1");
    bytes32 internal constant RECOVERY = keccak256("Termbook Wormhole recovery operation v1");

    uint8 internal constant LOCK = 1;
    uint8 internal constant APPLIED = 2;
    uint8 internal constant UNCONSUMED = 3;
}
