// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {ReferenceAssetApp} from "./ReferenceAssetApp.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";

contract ReferenceCore {
    mapping(bytes32 => address) public creditAccount;
    function bind(bytes32 id, address account) external { creditAccount[id] = account; }
}

contract ReferenceAssetAppTest is Test {
    MockERC20 token;
    ReferenceCore core;
    ReferenceAssetApp app;
    bytes32 constant CREDIT = keccak256("credit");
    address constant ACCOUNT = address(0xA1);

    function setUp() public {
        token = new MockERC20();
        core = new ReferenceCore();
        core.bind(CREDIT, ACCOUNT);
        app = new ReferenceAssetApp(address(core), address(token));
        token.mint(ACCOUNT, 100);
        vm.prank(ACCOUNT);
        token.approve(address(app), 100);
    }

    function _deposit(uint256 amount) private { vm.prank(ACCOUNT); app.deposit(amount); }

    function _action(bool depositing, uint256 amount) private view returns (ExecutionTypes.Action memory action) {
        action.capability = depositing ? app.DEPOSIT() : app.WITHDRAW();
        action.market = app.MARKET();
        action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(app), depositing ? address(token) : address(0),
            depositing ? amount : 0, abi.encodeWithSelector(depositing ? app.deposit.selector : app.withdraw.selector, amount), 0);
        action.requiredInput = depositing ? amount : 0;
        action.exposureLimit = 100;
    }

    function testPositionValueIsBackedByRedeemableTokens() public {
        _deposit(60);
        (int256 value, uint16 retained,, uint256 at) = app.readAppValue(CREDIT, ACCOUNT, address(token));
        assertEq(value, 60);
        assertEq(retained, 10_000);
        assertEq(at, block.timestamp);
        assertEq(app.liabilities(), token.balanceOf(address(app)));
        assertEq(app.positionCount(CREDIT, ACCOUNT), 1);
        vm.prank(ACCOUNT);
        app.withdraw(60);
        assertEq(app.positionCount(CREDIT, ACCOUNT), 0);
        assertEq(token.balanceOf(ACCOUNT), 100);
    }

    function testAnotherWalletCannotWithdrawAccountPosition() public {
        _deposit(60);
        vm.prank(address(0xBAD));
        vm.expectRevert(ReferenceAssetApp.Invalid.selector);
        app.withdraw(60);
        assertEq(app.positions(ACCOUNT), 60);
    }

    function testRecoveryVerifiesBothPositionAndReturnedAccountCash() public {
        _deposit(60);
        (address target, bytes memory call_,, bytes32 expected) = app.recoveryCall(CREDIT, ACCOUNT, abi.encode(uint256(60)));
        assertEq(target, address(app));
        assertFalse(app.verifyRecovery(CREDIT, ACCOUNT, "", expected));
        vm.prank(ACCOUNT);
        (bool ok,) = target.call(call_);
        assertTrue(ok);
        assertTrue(app.verifyRecovery(CREDIT, ACCOUNT, "", expected));
        assertEq(token.balanceOf(ACCOUNT), 100);
    }

    function testExecutionPolicyRejectsIncorrectFundingAndMarket() public {
        ExecutionTypes.Action memory action = _action(true, 60);
        action.requiredInput = 1;
        vm.expectRevert(ReferenceAssetApp.Invalid.selector);
        app.prepare(CREDIT, ACCOUNT, action);
        action = _action(true, 60);
        action.market = bytes32(uint256(1));
        vm.expectRevert(ReferenceAssetApp.Invalid.selector);
        app.prepare(CREDIT, ACCOUNT, action);
    }

    function testExecutionResultChecksActualPositionChange() public {
        ExecutionTypes.Action memory action = _action(true, 60);
        (bytes32 previous, uint8 slots,, uint256 exposure) = app.prepare(CREDIT, ACCOUNT, action);
        assertEq(slots, 1);
        assertEq(exposure, 60);
        bytes[] memory results = new bytes[](1);
        vm.expectRevert(ReferenceAssetApp.Invalid.selector);
        app.verifyResult(CREDIT, ACCOUNT, action, previous, results);
        _deposit(60);
        assertEq(app.verifyResult(CREDIT, ACCOUNT, action, previous, results).length, 0);
    }

    function testInsolvencyAndWrongCreditIdentityFailClosed() public {
        _deposit(60);
        vm.expectRevert(ReferenceAssetApp.Invalid.selector);
        app.readAppValue(bytes32(uint256(1)), ACCOUNT, address(token));
        vm.prank(address(app));
        token.transfer(address(0xBAD), 1);
        vm.expectRevert(ReferenceAssetApp.Invalid.selector);
        app.readAppValue(CREDIT, ACCOUNT, address(token));
        vm.prank(ACCOUNT);
        vm.expectRevert(ReferenceAssetApp.Invalid.selector);
        app.withdraw(60);
    }
}
