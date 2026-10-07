// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AppGateway} from "../../src/monad/integration/AppGateway.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";

contract GatewayTarget { function act(uint256,address,bytes32) external {} }
contract GatewayTest is Test {
    GatewayTarget target;
    GatewayTarget account;
    GatewayTarget token;
    AppGateway gateway;
    bytes32 constant CAPABILITY = keccak256("act");
    function setUp() public {
        target = new GatewayTarget(); account = new GatewayTarget(); token = new GatewayTarget();
        AppGateway.Rule[] memory rules = new AppGateway.Rule[](1);
        rules[0] = AppGateway.Rule(CAPABILITY, address(target), GatewayTarget.act.selector, 96, 1, 2, address(token), 0, 100, 0);
        gateway = new AppGateway(rules);
    }
    function testNativeGatewayCapsValueWithoutAddingSettlementSpending() public {
        AppGateway.Rule[] memory rules = new AppGateway.Rule[](1);
        rules[0] = AppGateway.Rule(CAPABILITY, address(target), GatewayTarget.act.selector, 96, 1, 2,
            address(0), type(uint16).max, 0, 1 ether);
        AppGateway nativeGateway = new AppGateway(rules);
        ExecutionTypes.Call memory call_ = nativeGateway.buildNativeCall(keccak256("credit"), address(account), CAPABILITY,
            abi.encode(uint256(50), address(1), bytes32(0)), 1 ether);
        assertEq(call_.nativeValue, 1 ether); assertEq(call_.spendAmount, 0);
        vm.expectRevert(AppGateway.Bounds.selector);
        nativeGateway.buildNativeCall(keccak256("credit"), address(account), CAPABILITY,
            abi.encode(uint256(50), address(1), bytes32(0)), 1 ether + 1);
    }
    function testFixedMappingBindsAccountAndCreditWithoutMovingAssets() public view {
        bytes32 id = keccak256("credit");
        ExecutionTypes.Call memory call_ = gateway.buildCall(id, address(account), CAPABILITY, abi.encode(uint256(50), address(1), bytes32(0)));
        assertEq(call_.target, address(target)); assertEq(call_.spendToken, address(token)); assertEq(call_.spendAmount, 50);
        assertEq(call_.data, abi.encodeWithSelector(GatewayTarget.act.selector, 50, address(account), id));
    }
    function testRejectsUnknownMappingUnboundAccountAndExcessSpend() public {
        vm.expectRevert(AppGateway.Invalid.selector);
        gateway.buildCall(keccak256("credit"), address(account), bytes32(0), abi.encode(uint256(50), address(1), bytes32(0)));
        vm.expectRevert(AppGateway.Invalid.selector);
        gateway.buildCall(keccak256("credit"), address(1), CAPABILITY, abi.encode(uint256(50), address(1), bytes32(0)));
        vm.expectRevert(AppGateway.Bounds.selector);
        gateway.buildCall(keccak256("credit"), address(account), CAPABILITY, abi.encode(uint256(101), address(1), bytes32(0)));
        vm.expectRevert(AppGateway.Invalid.selector);
        gateway.buildCall(keccak256("credit"), address(account), CAPABILITY, abi.encode(uint256(50)));
    }
    function testRejectsChangedTargetOrTokenCode() public {
        vm.etch(address(target), hex"00");
        vm.expectRevert(AppGateway.Invalid.selector);
        gateway.buildCall(keccak256("credit"), address(account), CAPABILITY, abi.encode(uint256(50), address(1), bytes32(0)));
        vm.etch(address(target), type(GatewayTarget).runtimeCode); vm.etch(address(token), hex"00");
        vm.expectRevert(AppGateway.Invalid.selector);
        gateway.buildCall(keccak256("credit"), address(account), CAPABILITY, abi.encode(uint256(50), address(1), bytes32(0)));
    }
}
