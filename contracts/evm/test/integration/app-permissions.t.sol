// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {IAppCallValidator} from "../../src/monad/integration/IAppCallValidator.sol";

contract TestCallValidator is IAppCallValidator {
    bool public allowed = true;

    function setAllowed(bool value) external { allowed = value; }

    function validateAction(bytes32, address, bytes calldata, address, uint256) external view returns (bool) {
        return allowed;
    }

    function validateRecovery(bytes32, address, bytes calldata, address) external view returns (bool) {
        return allowed;
    }
}

contract PermissionTarget {
    function execute() external {}
}

contract BoundPermissionTarget {
    function execute(address, uint256) external {}
}

contract AppPermissionsTest is Test {
    function testNativeValueNeedsSeparateImmutableActionAndRecoveryApproval() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        BoundPermissionTarget target = new BoundPermissionTarget();
        TestCallValidator validator = new TestCallValidator();
        bytes32 id = bytes32("native"); address account = address(0xA);
        r.approve(id, bytes32("code"));
        r.registerCall(id, address(target), target.execute.selector, 68, 0, 1, 100);
        r.registerRecoveryCall(id, address(target), target.execute.selector, 68, 0);
        r.setCallValidator(id, address(target), target.execute.selector, address(validator));
        r.setRecoveryCallValidator(id, address(target), target.execute.selector, address(validator));
        bytes memory data = abi.encodeCall(target.execute, (account, 50));
        assertFalse(r.validateValueCall(id, address(target), data, account, 0, 50));
        r.registerNativeValue(id, address(target), target.execute.selector, false, 100, 1);
        r.registerNativeValue(id, address(target), target.execute.selector, true, 60, 1);
        r.activate(id);
        assertTrue(r.validateValueCall(id, address(target), data, account, 0, 50));
        assertFalse(r.validateValueCall(id, address(target), data, account, 0, 0));
        assertFalse(r.validateValueCall(id, address(target), data, account, 0, 51));
        assertFalse(r.validateValueCall(id, address(target), abi.encodeCall(target.execute, (account, 101)), account, 0, 101));
        vm.expectRevert(IntegrationRegistry.Invalid.selector);
        r.registerNativeValue(id, address(target), target.execute.selector, false, 200, 1);
        r.freeze(id);
        assertFalse(r.validateValueCall(id, address(target), data, account, 0, 50));
        assertTrue(r.validateRecoveryValueCall(id, address(target), data, account, 50));
        assertFalse(r.validateRecoveryValueCall(id, address(target), abi.encodeCall(target.execute, (account, 61)), account, 61));
        r.disableRecoveryCall(id, address(target), target.execute.selector);
        assertFalse(r.validateRecoveryValueCall(id, address(target), data, account, 50));
    }
    function testFreezeBlocksUse() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        r.approve(bytes32("v1"), bytes32("code"));
        assertFalse(r.isActive(bytes32("v1")));
        r.freeze(bytes32("v1"));
        (,, bool frozen) = r.versions(bytes32("v1"));
        assertTrue(frozen);
    }

    function testCodeIdentityMustRemainTheReviewedDeployment() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        PermissionTarget target = new PermissionTarget();
        r.approve(bytes32("v1"), bytes32("code"));
        r.registerCall(
            bytes32("v1"), address(target), PermissionTarget.execute.selector, 4, type(uint8).max, type(uint8).max, 0
        );
        r.setCallValidator(bytes32("v1"), address(target), PermissionTarget.execute.selector, address(new TestCallValidator()));
        r.activate(bytes32("v1"));
        assertTrue(r.isActive(bytes32("v1")));
        assertTrue(r.isCallAllowed(bytes32("v1"), address(target), PermissionTarget.execute.selector));
        vm.etch(address(target), hex"6000");
        assertFalse(r.isCallAllowed(bytes32("v1"), address(target), PermissionTarget.execute.selector));
        r.freeze(bytes32("v1"));
        assertFalse(r.isActive(bytes32("v1")));
    }

    function testCallParametersAreBoundToTheCreditAccount() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        BoundPermissionTarget target = new BoundPermissionTarget();
        address account = address(0xA11CE);
        r.approve(bytes32("v1"), bytes32("code"));
        r.registerCall(bytes32("v1"), address(target), BoundPermissionTarget.execute.selector, 68, 0, 1, 100);
        r.setCallValidator(bytes32("v1"), address(target), BoundPermissionTarget.execute.selector,
            address(new TestCallValidator()));
        r.activate(bytes32("v1"));
        bytes memory valid = abi.encodeCall(BoundPermissionTarget.execute, (account, 50));
        assertTrue(r.validateCall(bytes32("v1"), address(target), valid, account, 50));
        bytes memory wrongRecipient = abi.encodeCall(BoundPermissionTarget.execute, (address(0xB0B), 50));
        assertFalse(r.validateCall(bytes32("v1"), address(target), wrongRecipient, account, 50));
        bytes memory tooLarge = abi.encodeCall(BoundPermissionTarget.execute, (account, 101));
        assertFalse(r.validateCall(bytes32("v1"), address(target), tooLarge, account, 50));
    }

    function testActiveVersionCannotChangeCallPolicy() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        BoundPermissionTarget target = new BoundPermissionTarget();
        bytes32 id = bytes32("v1");
        r.approve(id, bytes32("code"));
        r.registerCall(id, address(target), BoundPermissionTarget.execute.selector, 68, 0, 1, 100);
        r.setCallValidator(id, address(target), BoundPermissionTarget.execute.selector, address(new TestCallValidator()));
        r.activate(id);
        vm.expectRevert(IntegrationRegistry.Invalid.selector);
        r.registerCall(id, address(target), BoundPermissionTarget.execute.selector, 68, 0, 1, 1_000);
    }

    function testRecoveryCallBindsTargetAndAccount() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        BoundPermissionTarget target = new BoundPermissionTarget();
        bytes32 id = bytes32("recovery");
        address account = address(0xA11CE);
        r.approve(id, bytes32("code"));
        r.registerCall(id, address(target), BoundPermissionTarget.execute.selector, 68, 0, 1, 100);
        r.registerRecoveryCall(id, address(target), BoundPermissionTarget.execute.selector, 68, 0);
        TestCallValidator validator = new TestCallValidator();
        r.setCallValidator(id, address(target), BoundPermissionTarget.execute.selector, address(validator));
        r.setRecoveryCallValidator(id, address(target), BoundPermissionTarget.execute.selector, address(validator));
        r.activate(id);
        assertEq(r.recoveryCallCount(id), 1);
        bytes memory data = abi.encodeCall(BoundPermissionTarget.execute, (account, 50));
        assertTrue(r.validateRecoveryCall(id, address(target), data, account));
        assertFalse(r.validateRecoveryCall(id, address(target), data, address(0xB0B)));
        vm.expectRevert(IntegrationRegistry.Invalid.selector);
        r.registerRecoveryCall(id, address(target), BoundPermissionTarget.execute.selector, 68, 0);
        vm.etch(address(target), hex"6000");
        assertFalse(r.validateRecoveryCall(id, address(target), data, account));
    }

    function testFrozenVersionStillAllowsRegisteredRecovery() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        PermissionTarget target = new PermissionTarget();
        bytes32 id = bytes32("recovery");
        r.approve(id, bytes32("code"));
        r.registerCall(id, address(target), PermissionTarget.execute.selector, 4, type(uint8).max, type(uint8).max, 0);
        r.registerRecoveryCall(id, address(target), PermissionTarget.execute.selector, 4, type(uint8).max);
        TestCallValidator validator = new TestCallValidator();
        r.setCallValidator(id, address(target), PermissionTarget.execute.selector, address(validator));
        r.setRecoveryCallValidator(id, address(target), PermissionTarget.execute.selector, address(validator));
        r.activate(id);
        r.freeze(id);
        assertFalse(r.isActive(id));
        assertTrue(r.validateRecoveryCall(id, address(target), abi.encodeCall(PermissionTarget.execute, ()), address(this)));
        r.disableRecoveryCall(id, address(target), PermissionTarget.execute.selector);
        assertEq(r.recoveryCallCount(id), 0);
        assertFalse(r.validateRecoveryCall(id, address(target), abi.encodeCall(PermissionTarget.execute, ()), address(this)));
    }

    function testValidatorsAreRequiredAndCheckedAtRuntime() public {
        IntegrationRegistry r = new IntegrationRegistry(address(this));
        PermissionTarget target = new PermissionTarget();
        TestCallValidator validator = new TestCallValidator();
        bytes32 id = bytes32("v1");
        r.approve(id, bytes32("code"));
        r.registerCall(id, address(target), PermissionTarget.execute.selector, 4, type(uint8).max, type(uint8).max, 0);
        vm.expectRevert(IntegrationRegistry.Invalid.selector);
        r.activate(id);
        r.setCallValidator(id, address(target), PermissionTarget.execute.selector, address(validator));
        r.activate(id);
        bytes memory data = abi.encodeCall(PermissionTarget.execute, ());
        assertTrue(r.validateCall(id, address(target), data, address(this), 0));
        validator.setAllowed(false);
        assertFalse(r.validateCall(id, address(target), data, address(this), 0));
        validator.setAllowed(true);
        vm.etch(address(validator), hex"6000");
        assertFalse(r.validateCall(id, address(target), data, address(this), 0));
    }
}
