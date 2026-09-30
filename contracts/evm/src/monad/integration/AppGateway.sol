// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppGateway} from "./IAppGateway.sol";
import {ExecutionTypes} from "./IExecutionPolicy.sol";

contract AppGateway is IAppGateway {
    uint16 public constant NO_WORD = type(uint16).max;
    struct Rule {
        bytes32 capability;
        address target;
        bytes4 selector;
        uint16 paramsLength;
        uint16 accountWord;
        uint16 creditWord;
        address spendToken;
        uint16 spendWord;
        uint256 maxSpend;
    }
    mapping(bytes32 => Rule) private rules;
    mapping(bytes32 => bytes32) public targetCodeHash;
    mapping(bytes32 => bytes32) public spendTokenCodeHash;
    bytes32 public immutable manifestHash;
    error Invalid();
    error Bounds();

    constructor(Rule[] memory rules_) {
        if (rules_.length == 0 || rules_.length > 32) revert Invalid();
        manifestHash = keccak256(abi.encode(rules_));
        for (uint256 i; i < rules_.length; ++i) {
            Rule memory r = rules_[i];
            uint256 words = r.paramsLength / 32;
            if (r.capability == bytes32(0) || rules[r.capability].target != address(0)
                || r.target.code.length == 0 || r.selector == bytes4(0) || r.paramsLength > 16_352
                || r.paramsLength % 32 != 0 || (r.accountWord != NO_WORD && r.accountWord >= words)
                || (r.creditWord != NO_WORD && r.creditWord >= words)
                || (r.accountWord != NO_WORD && r.accountWord == r.creditWord)
                || (r.spendToken == address(0) ? r.spendWord != NO_WORD || r.maxSpend != 0
                    : r.spendToken.code.length == 0 || r.spendWord >= words || r.maxSpend == 0
                        || r.spendWord == r.accountWord || r.spendWord == r.creditWord)) revert Invalid();
            rules[r.capability] = r;
            targetCodeHash[r.capability] = r.target.codehash;
            if (r.spendToken != address(0)) spendTokenCodeHash[r.capability] = r.spendToken.codehash;
        }
    }

    function rule(bytes32 capability) external view returns (Rule memory) { return rules[capability]; }

    function buildCall(bytes32 creditId, address account, bytes32 capability, bytes calldata params)
        external view returns (ExecutionTypes.Call memory call_) {
        Rule memory r = rules[capability];
        if (creditId == bytes32(0) || account.code.length == 0 || r.target.code.length == 0
            || r.target.codehash != targetCodeHash[capability] || params.length != r.paramsLength
            || (r.spendToken != address(0) && (r.spendToken.code.length == 0
                || r.spendToken.codehash != spendTokenCodeHash[capability]))) revert Invalid();
        bytes memory arguments = params;
        if (r.accountWord != NO_WORD) _word(arguments, r.accountWord, bytes32(uint256(uint160(account))));
        if (r.creditWord != NO_WORD) _word(arguments, r.creditWord, creditId);
        uint256 spend;
        if (r.spendToken != address(0)) {
            uint256 offset = r.spendWord;
            assembly { spend := mload(add(add(arguments, 32), mul(offset, 32))) }
            if (spend > r.maxSpend) revert Bounds();
        }
        call_ = ExecutionTypes.Call(r.target, r.spendToken, spend, abi.encodePacked(r.selector, arguments));
    }

    function _word(bytes memory arguments, uint256 index, bytes32 value) private pure {
        assembly { mstore(add(add(arguments, 32), mul(index, 32)), value) }
    }
}
