// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ExecutionManager} from "../../src/monad/integration/ExecutionManager.sol";
import {ExecutionTypes, IExecutionPolicy} from "../../src/monad/integration/IExecutionPolicy.sol";
import {IAppStateReader} from "../../src/monad/integration/IAppStateReader.sol";
import {MockERC20} from "../MockERC20.sol";

contract ExecutionPolicyFixture is IExecutionPolicy, IAppStateReader {
    ExecutionTypes.PendingState private current;
    bytes32 public id = keccak256("order");
    uint256 public positions;
    uint8 public newPositionSlots = 1;
    bool public pendingVisible;
    bool public valid = true;
    address public immutable account;
    MockERC20 public token;
    uint256 public callsExecuted;
    bool public rejectSubmission;

    constructor(address account_) { account = account_; }
    function stateReader() external view returns (address) { return address(this); }
    function supportsInterface(bytes4 value) external pure returns (bool) { return value == type(IAppStateReader).interfaceId; }
    function positionCount(bytes32, address) external view returns (uint256) { return positions; }
    function positionAt(bytes32, address, uint256 index) external pure returns (bytes32, bytes32) {
        return (bytes32(index + 1), keccak256("ETH"));
    }
    function pendingCount(bytes32, address) external view returns (uint256) { return pendingVisible ? 1 : 0; }
    function pendingAt(bytes32, address, uint256) external view returns (bytes32, bytes32, uint256, uint256) {
        return (id, current.positionId, current.liability, current.deadline);
    }
    function prepare(bytes32, address, ExecutionTypes.Action calldata action)
        external view returns (bytes32, uint8, uint8, uint256) {
        require(valid && action.capability == keccak256("place_order") && action.market == keccak256("ETH"));
        require(action.requiredInput == 100 && action.calls.length > 0 && action.calls.length <= 2);
        return (keccak256("before"), newPositionSlots, 1, 100);
    }
    function verifyResult(bytes32, address, ExecutionTypes.Action calldata, bytes32 beforeState, bytes[] calldata)
        external pure returns (bytes32[] memory ids) {
        require(beforeState == keccak256("before"));
        ids = new bytes32[](1);
        ids[0] = keccak256("order");
    }
    function pendingState(bytes32, address, bytes32 pendingId) external view returns (ExecutionTypes.PendingState memory state) {
        require(pendingId == id);
        state = current;
        state.observedAt = block.timestamp;
    }
    function submit() external {
        require(!rejectSubmission);
        if (address(token) != address(0)) require(msg.sender == account && token.transferFrom(account, address(this), 100));
        pendingVisible = true;
        current = ExecutionTypes.PendingState(keccak256("position"), 100, 0, 0, 100, 100, 100,
            block.timestamp + 1 days, block.timestamp, 1, account, ExecutionTypes.Status.Pending);
    }
    function fill(uint256 amount, uint256 refund, bool cancellationRequested) external {
        current.filled = amount;
        current.refunded = refund;
        current.remaining = 100 - amount - refund;
        current.liability = current.remaining;
        if (amount != 0) { positions = 1; current.positionSlots = 0; }
        if (current.remaining == 0) {
            current.positionSlots = 0;
            pendingVisible = false;
            current.status = refund == 100 ? ExecutionTypes.Status.Cancelled : ExecutionTypes.Status.Settled;
        } else if (cancellationRequested) current.status = ExecutionTypes.Status.CancelRequested;
    }
    function setPositions(uint256 value) external { positions = value; }
    function setLiability(uint256 value) external { current.liability = value; }
    function setRecipient(address value) external { current.refundRecipient = value; }
    function setToken(MockERC20 value) external { token = value; }
    function setRejected(bool value) external { rejectSubmission = value; }
    function noop() external { callsExecuted += 1; }
}

contract ExecutionManagerTest is Test {
    ExecutionManager manager;
    ExecutionPolicyFixture policy;
    bytes32 bundle = keccak256("bundle");
    bytes32 credit = keccak256("credit");
    address account = address(0xAC);
    address sessionKey = address(0xDE);

    function setUp() public {
        vm.warp(1_000);
        manager = new ExecutionManager(address(this));
        policy = new ExecutionPolicyFixture(account);
        manager.configure(bundle, address(policy), 2, 2, 300);
    }

    function _action() internal view returns (ExecutionTypes.Action memory action) {
        action.capability = keccak256("place_order");
        action.market = keccak256("ETH");
        action.requiredInput = 100;
        action.exposureLimit = 100;
        action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(policy), address(0), 0,
            abi.encodeCall(ExecutionPolicyFixture.noop, ()));
    }
    function _submit() internal {
        ExecutionTypes.Action memory action = _action();
        ExecutionManager.Reservation memory reservation = manager.prepare(credit, bundle, account, action);
        policy.submit();
        bytes[] memory results = new bytes[](1);
        manager.complete(credit, bundle, account, action, reservation, results);
    }

    function testPartialFillAndCancellationRaceRetainRemainingExposure() public {
        _submit();
        policy.fill(40, 0, true);
        assertTrue(manager.sync(credit, bundle, account));
        assertEq(manager.pendingCount(credit), 1);
        assertEq(manager.reservedPositionSlots(credit), 0);
        ExecutionManager.Record memory record = _record();
        assertEq(record.state.remaining, 60);
        assertEq(record.state.liability, 60);
        assertEq(uint256(record.state.status), uint256(ExecutionTypes.Status.CancelRequested));
        policy.fill(70, 30, false);
        assertTrue(manager.sync(credit, bundle, account));
        assertEq(manager.pendingCount(credit), 0);
        assertFalse(manager.sync(credit, bundle, account));
        record = _record();
        assertEq(record.state.filled, 70);
        assertEq(record.state.refunded, 30);
    }

    function _record() internal view returns (ExecutionManager.Record memory record) {
        (record.capability, record.market, record.exposureLimit, record.reservedSlots, record.state) =
            manager.records(credit, policy.id());
    }

    function testPendingSlotsReserveCapacityBeforeSubmission() public {
        policy.setPositions(2);
        vm.expectRevert(ExecutionManager.Bounds.selector);
        manager.prepare(credit, bundle, account, _action());
    }

    function testExternalExposureBreachIsRecordedWithoutRevertingTheFill() public {
        _submit();
        policy.setLiability(101);
        assertTrue(manager.sync(credit, bundle, account));
        assertTrue(manager.breached(credit));
        vm.expectRevert(ExecutionManager.Bounds.selector);
        manager.prepare(credit, bundle, account, _action());
    }

    function testRefundDestinationAndDuplicatePendingIdsCannotChange() public {
        _submit();
        policy.setRecipient(address(0xBAD));
        vm.expectRevert(ExecutionManager.Invalid.selector);
        manager.sync(credit, bundle, account);
        policy.setRecipient(account);
        ExecutionTypes.Action memory action = _action();
        ExecutionManager.Reservation memory reservation = manager.prepare(credit, bundle, account, action);
        bytes[] memory results = new bytes[](1);
        vm.expectRevert(ExecutionManager.Invalid.selector);
        manager.complete(credit, bundle, account, action, reservation, results);
    }

    function testSessionsBindMarketsSpendExposureNonceAndGeneration() public {
        ExecutionManager.Permission[] memory permissions = new ExecutionManager.Permission[](1);
        permissions[0] = ExecutionManager.Permission(keccak256("place_order"), keccak256("ETH"));
        manager.configureSession(credit, bundle, sessionKey, permissions, 100, 150, 200, 250, block.timestamp + 100, 3);
        manager.consumeSession(credit, bundle, sessionKey, permissions[0].capability, permissions[0].market, 100, 150, 1, 3);
        vm.expectRevert(ExecutionManager.Unauthorized.selector);
        manager.consumeSession(credit, bundle, sessionKey, permissions[0].capability, keccak256("SOL"), 10, 10, 2, 3);
        vm.expectRevert(ExecutionManager.Unauthorized.selector);
        manager.consumeSession(credit, bundle, sessionKey, permissions[0].capability, permissions[0].market, 51, 10, 2, 3);
        vm.expectRevert(ExecutionManager.Unauthorized.selector);
        manager.consumeSession(credit, bundle, sessionKey, permissions[0].capability, permissions[0].market, 10, 101, 2, 3);
        vm.expectRevert(ExecutionManager.Unauthorized.selector);
        manager.consumeSession(credit, bundle, sessionKey, permissions[0].capability, permissions[0].market, 10, 10, 2, 4);
        manager.revokeSession(credit, sessionKey);
        vm.expectRevert(ExecutionManager.Unauthorized.selector);
        manager.consumeSession(credit, bundle, sessionKey, permissions[0].capability, permissions[0].market, 10, 10, 3, 3);
    }
}
