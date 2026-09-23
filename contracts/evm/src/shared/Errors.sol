// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Errors {
    error Expired();
    error Unauthorized();
    error InvalidState();
    error InsufficientHealth();
    error LimitExceeded();
    error InvalidProof();
    error Replay();
    error Paused();
    error BelowFloor();
    error InsufficientLiquidity();
    error InvalidRecipient();
    error BadSignature();
    error StalePrice();
    error FrozenIntegration();
    error OverCapacity();
    error NothingToSettle();
    error Reentered();
    error ZeroShares();
    error WrongChain();
    error BadTerms();
}
