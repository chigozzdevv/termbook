// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "./IVerifier.sol";

contract MonadVerifier is IVerifier {
    uint256 public immutable finalityDepth;

    constructor(uint256 finalityDepth_) {
        finalityDepth = finalityDepth_;
    }

    function verifyFinality(bytes calldata header) external view returns (bool) {
        if (header.length != 96) return false;
        (uint256 height, uint256 finalizedHeight,) = abi.decode(header, (uint256, uint256, bytes32));
        return finalizedHeight >= height && finalizedHeight >= finalityDepth;
    }

    function verifyInclusion(bytes calldata proof, bytes32 root) external pure returns (bool) {
        if (proof.length < 128) return false;
        (bytes32 leaf, bytes32[] memory siblings, uint256 index) = abi.decode(proof, (bytes32, bytes32[], uint256));
        bytes32 current = leaf;
        for (uint256 i = 0; i < siblings.length; i++) {
            bytes32 sibling = siblings[i];
            current = index & 1 == 0
                ? keccak256(abi.encodePacked(current, sibling))
                : keccak256(abi.encodePacked(sibling, current));
            index >>= 1;
        }
        return current == root;
    }

    function headerRoot(bytes calldata header) external pure returns (bytes32 root) {
        if (header.length != 96) revert("header");
        (, , root) = abi.decode(header, (uint256, uint256, bytes32));
    }

    function proofLeaf(bytes calldata proof) external pure returns (bytes32 leaf) {
        (leaf,,) = abi.decode(proof, (bytes32, bytes32[], uint256));
    }
}
