// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VerifierRegistry {
    struct Verifier {
        address impl;
        uint256 version;
        bool active;
        uint256 maxAge;
    }

    mapping(uint256 => Verifier) public verifiers;
    address public governance;

    event VerifierSet(uint256 indexed chainId, address impl, uint256 version);
    error Unauthorized();
    error Invalid();

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
    }

    function setVerifier(uint256 chainId, address impl, uint256 version, uint256 maxAge) external {
        if (msg.sender != governance || impl.code.length == 0 || version == 0 || maxAge == 0) revert Invalid();
        verifiers[chainId] = Verifier(impl, version, true, maxAge);
        emit VerifierSet(chainId, impl, version);
    }

    function disable(uint256 chainId) external {
        if (msg.sender != governance) revert Unauthorized();
        verifiers[chainId].active = false;
    }

    function getVerifier(uint256 chainId) external view returns (Verifier memory) {
        return verifiers[chainId];
    }
}
