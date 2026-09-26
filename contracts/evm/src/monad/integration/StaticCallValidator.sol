// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAppCallValidator} from "./IAppCallValidator.sol";

contract StaticCallValidator is IAppCallValidator {
    enum RuleKind { Exact, Account, Range, Spend }

    struct Rule {
        RuleKind kind;
        bytes32 exact;
        uint256 minimum;
        uint256 maximum;
    }

    bytes32 public immutable versionId;
    address public immutable target;
    bytes4 public immutable selector;
    bool public immutable recoveryEnabled;
    Rule[] private rules;

    error Invalid();

    constructor(bytes32 versionId_, address target_, bytes4 selector_, bool recoveryEnabled_, Rule[] memory rules_) {
        if (versionId_ == bytes32(0) || target_.code.length == 0 || selector_ == bytes4(0)
            || rules_.length > 24) revert Invalid();
        versionId = versionId_;
        target = target_;
        selector = selector_;
        recoveryEnabled = recoveryEnabled_;
        for (uint256 i; i < rules_.length; ++i) {
            if (rules_[i].minimum > rules_[i].maximum
                || recoveryEnabled_ && rules_[i].kind == RuleKind.Spend
                || rules_[i].kind == RuleKind.Exact && (rules_[i].minimum != 0 || rules_[i].maximum != 0)
                || rules_[i].kind == RuleKind.Account
                    && (rules_[i].exact != bytes32(0) || rules_[i].minimum != 0 || rules_[i].maximum != 0)
                || (rules_[i].kind == RuleKind.Range || rules_[i].kind == RuleKind.Spend)
                    && rules_[i].exact != bytes32(0)) revert Invalid();
            rules.push(rules_[i]);
        }
    }

    function ruleCount() external view returns (uint256) {
        return rules.length;
    }

    function validateAction(bytes32 id, address target_, bytes calldata data, address account, uint256 spendAmount)
        external
        view
        returns (bool)
    {
        return _validate(id, target_, data, account, spendAmount);
    }

    function validateRecovery(bytes32 id, address target_, bytes calldata data, address account)
        external
        view
        returns (bool)
    {
        return recoveryEnabled && _validate(id, target_, data, account, 0);
    }

    function _validate(bytes32 id, address target_, bytes calldata data, address account, uint256 spendAmount)
        private
        view
        returns (bool)
    {
        if (id != versionId || target_ != target || account == address(0)
            || data.length != 4 + rules.length * 32 || bytes4(data[:4]) != selector) return false;
        for (uint256 i; i < rules.length; ++i) {
            uint256 word;
            assembly { word := calldataload(add(data.offset, add(4, mul(i, 32)))) }
            Rule storage rule = rules[i];
            if (rule.kind == RuleKind.Exact && bytes32(word) != rule.exact
                || rule.kind == RuleKind.Account && word != uint256(uint160(account))
                || rule.kind == RuleKind.Range && (word < rule.minimum || word > rule.maximum)
                || rule.kind == RuleKind.Spend && (word < rule.minimum || word > rule.maximum
                    || word > spendAmount)) return false;
        }
        return true;
    }
}
