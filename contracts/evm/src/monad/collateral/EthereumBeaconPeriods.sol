// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library EthereumBeaconPeriods {
    function advance(
        uint256 storePeriod,
        uint256 finalizedPeriod,
        uint256 attestedPeriod,
        bytes32 currentRoot,
        bytes32 knownNextRoot,
        bytes32 provenNextRoot
    ) internal pure returns (bytes32 newCurrentRoot, bytes32 newNextRoot, bool rotated, bool valid) {
        if (
            currentRoot == bytes32(0)
                || finalizedPeriod < storePeriod || finalizedPeriod > storePeriod + 1
                || attestedPeriod < finalizedPeriod || attestedPeriod > storePeriod + 1
        ) return (bytes32(0), bytes32(0), false, false);
        newCurrentRoot = currentRoot;
        newNextRoot = knownNextRoot;
        if (finalizedPeriod == storePeriod) {
            if (knownNextRoot == bytes32(0)) {
                if (attestedPeriod != storePeriod) return (bytes32(0), bytes32(0), false, false);
                newNextRoot = provenNextRoot;
            } else if (
                attestedPeriod == storePeriod && provenNextRoot != bytes32(0) && provenNextRoot != knownNextRoot
            ) {
                return (bytes32(0), bytes32(0), false, false);
            }
        } else {
            if (knownNextRoot == bytes32(0) || attestedPeriod != storePeriod + 1) {
                return (bytes32(0), bytes32(0), false, false);
            }
            newCurrentRoot = knownNextRoot;
            newNextRoot = provenNextRoot;
            rotated = true;
        }
        valid = true;
    }
}
