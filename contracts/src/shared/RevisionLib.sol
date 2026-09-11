// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library RevisionLib {
    function next(uint256 current) internal pure returns (uint256) {
        unchecked {
            return current + 1;
        }
    }
}
