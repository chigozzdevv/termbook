// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library WormholeConfirmationPolicy {
    address internal constant SEPOLIA_CCL = 0x6A4B4A882F5F0a447078b4Fd0b4B571A82371ec2;
    function configuration(uint16 depth) internal pure returns (bytes32) {
        return bytes32(abi.encodePacked(uint8(1), uint8(200), depth, bytes28(0)));
    }
    function digest(address publisher, uint16 depth) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256("Termbook Wormhole Sepolia confirmations v1"), uint256(11155111), publisher, configuration(depth)));
    }
    function safeDigest(uint256 sourceChain, address publisher) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256("Termbook Wormhole EVM safe confirmations v1"), sourceChain, publisher, uint8(201)));
    }
}

interface IWormholeConsistencyConfig {
    function configure(bytes32 config) external;
    function getConfiguration(address emitter) external view returns (bytes32);
}
