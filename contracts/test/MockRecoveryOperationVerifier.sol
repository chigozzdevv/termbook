// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockRecoveryOperationVerifier {
    uint256 public immutable chain;
    address public expectedFactory;
    bytes32 public expectedDigest;
    bool public valid = true;

    constructor(uint256 chain_) {
        chain = chain_;
    }

    function admission() external view returns (uint256, uint256, bytes32) {
        return (chain, 1, keccak256("checkpoint"));
    }

    function setExpected(address factory, bytes32 digest) external {
        expectedFactory = factory;
        expectedDigest = digest;
    }

    function setValid(bool value) external {
        valid = value;
    }

    function verifyRecoveryOperation(bytes calldata header, bytes calldata proof, address factory, bytes32 digest)
        external
        view
        returns (bool)
    {
        return valid && header.length != 0 && proof.length != 0 && factory == expectedFactory
            && digest == expectedDigest;
    }
}
