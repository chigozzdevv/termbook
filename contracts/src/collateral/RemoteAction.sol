// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library RemoteAction {
    bytes32 internal constant DOMAIN = keccak256("Termbook remote collateral action v1");
    uint8 internal constant RELEASE = 0;
    uint8 internal constant SEIZE = 1;

    struct Authorization {
        uint256 monadChain;
        address monadCore;
        uint256 sourceChain;
        address sourceVault;
        bytes32 creditId;
        bytes32 lockId;
        address asset;
        uint8 kind;
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    function hash(Authorization memory action) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN, action.monadChain, action.monadCore, action.sourceChain, action.sourceVault,
            action.creditId, action.lockId, action.asset, action.kind, action.recipient,
            action.amount, action.nonce, action.deadline
        ));
    }
}
