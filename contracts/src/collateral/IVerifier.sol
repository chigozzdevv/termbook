// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVerifier {
    function verifyFinality(bytes calldata header) external view returns (bool);
    function verifyInclusion(bytes calldata proof, bytes32 root) external view returns (bool);
    function headerRoot(bytes calldata header) external pure returns (bytes32);
    function proofLeaf(bytes calldata proof) external pure returns (bytes32);
}
