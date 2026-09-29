// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntegrationRegistry} from "../src/monad/integration/IntegrationRegistry.sol";
import {StaticCallValidator} from "../src/monad/integration/StaticCallValidator.sol";
import {ImplementationGuard} from "../src/monad/integration/ImplementationGuard.sol";

contract AuditImplementationOne {
    function value() external pure returns (uint256) { return 1; }
}

contract AuditImplementationTwo {
    function value() external pure returns (uint256) { return 2; }
}

contract AuditProxy {
    address public implementation;
    address public immutable owner = msg.sender;

    function upgrade(address next) external {
        require(msg.sender == owner);
        implementation = next;
    }

    fallback() external {
        address target = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(success) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}

contract AuditProxyTest is Test {
    function testAuditProxyUpgradeInvalidatesAdmission() public {
        IntegrationRegistry registry = new IntegrationRegistry(address(this));
        AuditProxy proxy = new AuditProxy();
        address implementation = address(new AuditImplementationOne());
        proxy.upgrade(implementation);
        bytes32 id = keccak256("audit-proxy");
        bytes4 selector = AuditImplementationOne.value.selector;
        registry.approve(id, keccak256("reviewed"));
        registry.registerCall(id, address(proxy), selector, 4, type(uint8).max, type(uint8).max, 0);
        StaticCallValidator.Rule[] memory rules = new StaticCallValidator.Rule[](0);
        StaticCallValidator validator = new StaticCallValidator(id, address(proxy), selector, false, rules);
        registry.setCallValidator(id, address(proxy), selector, address(validator));
        AuditImplementationOne recovery = new AuditImplementationOne();
        registry.registerRecoveryCall(id, address(recovery), selector, 4, type(uint8).max);
        StaticCallValidator recoveryValidator = new StaticCallValidator(id, address(recovery), selector, true, rules);
        registry.setRecoveryCallValidator(id, address(recovery), selector, address(recoveryValidator));
        vm.expectRevert(IntegrationRegistry.Invalid.selector);
        registry.activate(id);
        ImplementationGuard guard = new ImplementationGuard(address(proxy), implementation, bytes4(keccak256("implementation()")));
        registry.setDependencyGuard(id, address(proxy), address(guard));
        registry.activate(id);
        bytes memory data = abi.encodeWithSelector(selector);
        assertTrue(registry.validateCall(id, address(proxy), data, address(this), 0));
        assertEq(AuditImplementationOne(address(proxy)).value(), 1);
        bytes32 reviewedHash = address(proxy).codehash;
        proxy.upgrade(address(new AuditImplementationTwo()));
        assertEq(address(proxy).codehash, reviewedHash);
        assertEq(AuditImplementationOne(address(proxy)).value(), 2);
        assertFalse(registry.validateCall(id, address(proxy), data, address(this), 0));
        assertFalse(registry.isActive(id));
        assertTrue(registry.validateRecoveryCall(id, address(recovery), data, address(this)));
    }
}
