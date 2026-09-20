// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVerifier {
    function verifyFinality(bytes calldata header) external view returns (bool);
    function verifyInclusion(bytes calldata proof, bytes32 root) external view returns (bool);
    function headerRoot(bytes calldata header) external view returns (bytes32);
    function proofLeaf(bytes calldata proof) external view returns (bytes32);
}

interface IVerifierAdmission {
    function admission() external view returns (uint256 chainId, uint256 consensusVersion, bytes32 bootstrapHash);
    function lightClient() external view returns (address);
    function proofMaxAge() external view returns (uint256);
}

interface IConsensusLightClient {
    function chainId() external view returns (uint256);
    function consensusVersion() external view returns (uint256);
    function bootstrapHash() external view returns (bytes32);
    function proofMaxAge() external view returns (uint256);
    function headerTimestamp(bytes calldata header) external view returns (uint256);
    function verifyFinality(bytes calldata header) external view returns (bool);
    function headerRoot(bytes calldata header) external view returns (bytes32);
    function verifyInclusion(bytes calldata proof, bytes32 root) external view returns (bool);
    function proofLeaf(bytes calldata proof) external view returns (bytes32);
}
