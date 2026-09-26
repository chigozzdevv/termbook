// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StaticCallValidator} from "../../src/monad/integration/StaticCallValidator.sol";

contract StaticTarget {
    function place(bytes32, uint256, address) external {}
}

contract StaticCallValidatorTest is Test {
    function testBindsEveryWordAndSpend() public {
        StaticTarget target = new StaticTarget();
        bytes32 id = keccak256("integration");
        address account = address(0xA11CE);
        StaticCallValidator.Rule[] memory rules = new StaticCallValidator.Rule[](3);
        rules[0] = StaticCallValidator.Rule(StaticCallValidator.RuleKind.Exact, bytes32("ETH"), 0, 0);
        rules[1] = StaticCallValidator.Rule(StaticCallValidator.RuleKind.Spend, bytes32(0), 1, 100);
        rules[2] = StaticCallValidator.Rule(StaticCallValidator.RuleKind.Account, bytes32(0), 0, 0);
        StaticCallValidator validator = new StaticCallValidator(id, address(target), StaticTarget.place.selector, false, rules);
        bytes memory valid = abi.encodeCall(StaticTarget.place, (bytes32("ETH"), 50, account));
        assertTrue(validator.validateAction(id, address(target), valid, account, 50));
        assertFalse(validator.validateAction(id, address(target), valid, account, 49));
        assertFalse(validator.validateAction(id, address(target), valid, address(0xB0B), 50));
        assertFalse(validator.validateAction(id, address(target),
            abi.encodeCall(StaticTarget.place, (bytes32("BTC"), 50, account)), account, 50));
        assertFalse(validator.validateAction(id, address(target), bytes.concat(valid, hex"00"), account, 50));
        assertFalse(validator.validateRecovery(id, address(target), valid, account));
    }
}
