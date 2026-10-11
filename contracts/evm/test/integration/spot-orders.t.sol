// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {ExecutionManager} from "../../src/monad/integration/ExecutionManager.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";
import {UseCaseReader} from "../../src/monad/integration/UseCaseReader.sol";
import {UseCasePolicy} from "../../src/monad/integration/UseCasePolicy.sol";
import {UseCaseRecovery} from "../../src/monad/integration/UseCaseRecovery.sol";
import {SpotOrderTracker} from "../../src/monad/integration/SpotOrderTracker.sol";
import {ReadProgram} from "../../src/monad/integration/ReadProgram.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";
import {UseCaseTest, StandardDollar, PriceFeedFixture, PriceFeedGuardFixture} from "./use-case.t.sol";
import {OracleRegistry} from "../../src/monad/risk/OracleRegistry.sol";

contract OrderCreditFixture {
    TermbookCore.Credit private credit;
    ExecutionManager public executionManager;
    OrderPriceFixture public priceProtection;
    constructor(address account, bytes32 bundle) {
        credit.account = account; credit.bundleId = bundle; credit.maturity = block.timestamp + 1 days;
        priceProtection = new OrderPriceFixture();
    }
    function setManager(ExecutionManager value) external { executionManager = value; }
    function creditDetails(bytes32) external view returns (TermbookCore.Credit memory) { return credit; }
}
contract OrderPriceFixture {
    function rule(bytes32, bytes32, bytes32) external view returns (PriceProtection.Rule memory value) { value.oracle = address(this); }
}
contract OrderVenueFixture {
    struct Order { address owner; uint256 quantity; uint256 price; bool buy; bool active; }
    mapping(uint256 => Order) public orders;
    mapping(address => mapping(address => uint256)) public balances;
    uint256 public counter;
    address public immutable settlement;
    constructor(address token) { settlement = token; }
    receive() external payable {}
    function deposit(address owner, address token, uint256 amount) external payable {
        if (token == address(0)) require(msg.value == amount);
        else { require(msg.value == 0); require(StandardDollar(token).transferFrom(msg.sender, address(this), amount)); }
        balances[owner][token] += amount;
    }
    function place(uint256 quantity, uint256 price, bool buy) external {
        address token = buy ? settlement : address(0);
        uint256 cost = buy ? quantity * price / 1 ether : quantity;
        balances[msg.sender][token] -= cost;
        orders[++counter] = Order(msg.sender, quantity, price, buy, true);
    }
    function fill(uint256 id, uint256 quantity) external {
        Order storage item = orders[id]; require(item.active && quantity <= item.quantity);
        balances[item.owner][item.buy ? address(0) : settlement] += item.buy ? quantity : quantity * item.price / 1 ether;
        if (quantity == item.quantity) item.active = false;
        else item.quantity -= quantity;
    }
    function cancel(uint256 id) external {
        Order memory item = orders[id]; require(item.owner == msg.sender && item.active);
        balances[msg.sender][item.buy ? settlement : address(0)] += item.buy ? item.quantity * item.price / 1 ether : item.quantity;
        delete orders[id];
    }
    function withdraw(uint256 amount, address token) external {
        balances[msg.sender][token] -= amount;
        if (token == address(0)) { (bool ok,) = msg.sender.call{value: amount}(""); require(ok); }
        else require(StandardDollar(token).transfer(msg.sender, amount));
    }
    function state(uint256 id) external view returns (uint256[6] memory result) {
        Order memory item = orders[id];
        return [uint256(uint160(item.owner)), item.active ? item.buy ? item.quantity * item.price / 1 ether : item.quantity : 0,
            item.active ? item.quantity : 0, item.price, item.buy ? 1 : 0, item.active ? 1 : 0];
    }
    function balance(address owner, address token) external view returns (uint256) { return balances[owner][token]; }
    function quote(uint256 amount) external pure returns (uint256, uint256) { return (amount, amount * 2e6 / 1 ether); }
}

contract SpotOrdersTest is Test {
    bytes32 constant bundle = keccak256("tracked-spot");
    bytes32 constant creditId = keccak256("tracked-credit");
    bytes32 constant market = keccak256("tracked-market");
    bytes32 constant buyRule = keccak256("buy");
    bytes32 constant sellRule = keccak256("sell");
    address constant account = address(0xB0B);
    OrderCreditFixture core;
    ExecutionManager manager;
    SpotOrderTracker tracker;
    UseCaseReader reader;
    UseCasePolicy policy;
    UseCaseRecovery recovery;
    ReadProgram programs;
    IntegrationRegistry registry;
    OrderVenueFixture venue;
    StandardDollar dollar;

    function setUp() public {
        vm.warp(10_000); vm.deal(account, 10 ether);
        core = new OrderCreditFixture(account, bundle); manager = ExecutionManager(deployCode("ExecutionManager.sol:ExecutionManager", abi.encode(address(core)))); core.setManager(manager);
        dollar = new StandardDollar(); dollar.mint(account, 20e6);
        venue = new OrderVenueFixture(address(dollar)); vm.deal(address(venue), 20 ether);
        registry = new IntegrationRegistry(address(this)); programs = new ReadProgram(address(this));
        tracker = SpotOrderTracker(deployCode("SpotOrderTracker.sol:SpotOrderTracker", abi.encode(address(this), address(core), address(registry), address(programs))));
        reader = UseCaseReader(deployCode("UseCaseReader.sol:UseCaseReader", abi.encode(address(this), address(core), address(registry), address(programs))));
        policy = UseCasePolicy(deployCode("UseCasePolicy.sol:UseCasePolicy", abi.encode(address(this), address(core), address(reader))));
        recovery = UseCaseRecovery(deployCode("UseCaseRecovery.sol:UseCaseRecovery", abi.encode(address(this), address(core), address(reader))));
        OracleRegistry oracle = new OracleRegistry(address(this)); PriceFeedFixture feed = new PriceFeedFixture(); feed.update(2e8);
        bytes32 feedId = keccak256("MON"); oracle.setFeed(feedId, address(feed), 1 days, 8);
        oracle.setFeedGuard(feedId, address(new PriceFeedGuardFixture(feed)));
        registry.approve(bundle, keccak256("definition"));
        address[8] memory dependencies = [address(venue), address(programs), address(tracker), address(reader), address(policy), address(recovery), address(dollar), address(oracle)];
        for (uint256 i; i < dependencies.length; ++i) registry.pinDependency(bundle, dependencies[i]);
        bytes32 counterProgram = _program(abi.encodeCall(venue.counter, ()), 1, 0);
        bytes32 stateProgram = _program(abi.encodeCall(venue.state, (0)), 6, 1);
        bytes32 balanceProgram;
        // Balance reads bind both the account and token independently.
        ReadProgram.Program memory balance;
        balance.queries = new ReadProgram.Query[](1); balance.steps = new ReadProgram.Step[](4); balance.outputs = new uint16[](2);
        balance.steps[0].op = ReadProgram.Op.Account; balance.steps[1].op = ReadProgram.Op.Index;
        balance.steps[2].op = ReadProgram.Op.Constant; balance.steps[3] = ReadProgram.Step(ReadProgram.Op.Word, 2, 0, 0, 0);
        ReadProgram.Argument[] memory args = new ReadProgram.Argument[](2); args[0] = ReadProgram.Argument(0, 0); args[1] = ReadProgram.Argument(1, 1);
        balance.queries[0] = ReadProgram.Query(address(0), abi.encodeCall(venue.balance, (address(0), address(0))), args, bytes32(0), 100_000);
        balance.outputs[0] = 0; balance.outputs[1] = 3; balanceProgram = keccak256(abi.encode(balance)); programs.configure(balanceProgram, balance);
        SpotOrderTracker.Rule[] memory rules = new SpotOrderTracker.Rule[](2);
        rules[0] = SpotOrderTracker.Rule(buyRule, market, address(venue), address(dollar), address(venue), counterProgram, stateProgram, balanceProgram, 20e6, 10 ether, true);
        rules[1] = SpotOrderTracker.Rule(sellRule, market, address(venue), address(0), address(venue), counterProgram, stateProgram, balanceProgram, 10 ether, 10 ether, false);
        tracker.configure(bundle, rules);
        UseCaseReader.Config memory config; config.settlement = address(dollar); config.orderTracker = address(tracker);
        config.retainedBps = 9_500; config.maxPositions = 3; config.maxPending = 8;
        config.assets = new UseCaseReader.Asset[](1);
        bytes32 quoteProgram = _program(abi.encodeCall(venue.quote, (0)), 2, 3);
        config.assets[0] = UseCaseReader.Asset(address(0), address(oracle), feedId, 18, 100 ether, 0, quoteProgram, address(venue));
        config.markets = new UseCaseReader.Market[](1);
        config.markets[0] = UseCaseReader.Market(market, address(0), config.assets[0], config.assets[0], 20e6);
        config.custody = new UseCaseReader.Custody[](2);
        config.custody[0] = UseCaseReader.Custody(address(venue), balanceProgram, address(dollar), 100e6, 0);
        config.custody[1] = UseCaseReader.Custody(address(venue), balanceProgram, address(0), 100 ether, 0);
        reader.configure(bundle, config);
        _policy();
        registry.registerCall(bundle, address(venue), venue.place.selector, 100, 255, 255, 0);
        registry.setCallValidator(bundle, address(venue), venue.place.selector, address(policy));
        vm.prank(address(core)); manager.configure(bundle, address(policy), 3, 8, 60);
        registry.activate(bundle);
    }
    function _program(bytes memory data, uint256 outputs, uint256 argument) private returns (bytes32 id) {
        ReadProgram.Program memory p; p.queries = new ReadProgram.Query[](1);
        ReadProgram.Argument[] memory args = new ReadProgram.Argument[](argument == 0 ? 0 : 1);
        if (argument != 0) args[0] = ReadProgram.Argument(0, 0);
        p.queries[0] = ReadProgram.Query(address(0), data, args, bytes32(0), 100_000);
        p.steps = new ReadProgram.Step[](1 + 2 * outputs); p.outputs = new uint16[](outputs);
        p.steps[0].op = argument == 3 ? ReadProgram.Op.Amount : ReadProgram.Op.Index;
        for (uint256 i; i < outputs; ++i) {
            p.steps[1 + i * 2] = ReadProgram.Step(ReadProgram.Op.Constant, 0, 0, 0, i);
            p.steps[2 + i * 2] = ReadProgram.Step(ReadProgram.Op.Word, uint16(1 + i * 2), 0, 0, 0);
            p.outputs[i] = uint16(2 + i * 2);
        }
        id = keccak256(abi.encode(p)); programs.configure(id, p);
    }
    function _word(UseCasePolicy.Kind kind, uint256 maximum) private pure returns (UseCasePolicy.Word memory) {
        return UseCasePolicy.Word(kind, bytes32(0), 0, maximum);
    }
    function _policy() private {
        UseCasePolicy.Call[] memory calls = new UseCasePolicy.Call[](4);
        UseCasePolicy.Word[] memory words = new UseCasePolicy.Word[](3);
        words[0] = _word(UseCasePolicy.Kind.Account, 0); words[1] = _word(UseCasePolicy.Kind.Range, type(uint160).max);
        words[2] = _word(UseCasePolicy.Kind.Range, 10 ether);
        calls[0] = UseCasePolicy.Call(address(venue), venue.deposit.selector, false, words, 10 ether, 255);
        words = new UseCasePolicy.Word[](4); words[0] = _word(UseCasePolicy.Kind.Credit, 0);
        for (uint256 j = 1; j < 4; ++j) words[j] = _word(UseCasePolicy.Kind.Range, type(uint256).max);
        calls[1] = UseCasePolicy.Call(address(tracker), tracker.beginOrder.selector, false, words, 0, 255);
        words = new UseCasePolicy.Word[](3);
        for (uint256 j; j < 3; ++j) words[j] = _word(UseCasePolicy.Kind.Range, type(uint256).max);
        calls[2] = UseCasePolicy.Call(address(venue), venue.place.selector, false, words, 0, 255);
        words = new UseCasePolicy.Word[](1); words[0] = _word(UseCasePolicy.Kind.Credit, 0);
        calls[3] = UseCasePolicy.Call(address(tracker), tracker.finishOrder.selector, false, words, 0, 255);
        UseCasePolicy.Action[] memory actions = new UseCasePolicy.Action[](3);
        actions[0] = UseCasePolicy.Action(keccak256("place_buy"), market, keccak256("place_order"), 20e6, 0, true, calls);
        actions[1] = UseCasePolicy.Action(keccak256("place_sell"), market, keccak256("place_order"), 0, 0, true, calls);
        UseCasePolicy.Call[] memory cancellation = new UseCasePolicy.Call[](2);
        words = new UseCasePolicy.Word[](3); words[0] = _word(UseCasePolicy.Kind.Credit, 0);
        words[1] = _word(UseCasePolicy.Kind.Range, type(uint160).max); words[2] = _word(UseCasePolicy.Kind.Range, 32);
        cancellation[0] = UseCasePolicy.Call(address(tracker), tracker.beginCancel.selector, true, words, 0, 255);
        words = new UseCasePolicy.Word[](1); words[0] = _word(UseCasePolicy.Kind.Range, 32);
        cancellation[1] = UseCasePolicy.Call(address(venue), venue.cancel.selector, true, words, 0, 255);
        actions[2] = UseCasePolicy.Action(keccak256("cancel"), market, keccak256("cancel_order"), 0, 0, false, cancellation);
        policy.configure(bundle, actions, calls);
    }
    function _action(bool buy, uint256 quantity) private view returns (ExecutionTypes.Action memory action) {
        uint256 funding = buy ? quantity * 2e6 / 1 ether : quantity;
        action.capability = keccak256(bytes(buy ? "place_buy" : "place_sell")); action.market = market;
        action.requiredInput = buy ? funding : 0; action.calls = new ExecutionTypes.Call[](4);
        action.calls[0] = ExecutionTypes.Call(address(venue), buy ? address(dollar) : address(0), buy ? funding : 0,
            abi.encodeCall(venue.deposit, (account, buy ? address(dollar) : address(0), funding)), buy ? 0 : funding);
        action.calls[1] = ExecutionTypes.Call(address(tracker), address(0), 0,
            abi.encodeCall(tracker.beginOrder, (creditId, buy ? buyRule : sellRule, quantity, 2e6)), 0);
        action.calls[2] = ExecutionTypes.Call(address(venue), address(0), 0, abi.encodeCall(venue.place, (quantity, 2e6, buy)), 0);
        action.calls[3] = ExecutionTypes.Call(address(tracker), address(0), 0, abi.encodeCall(tracker.finishOrder, (creditId)), 0);
    }
    function _place(bool buy, uint256 quantity) private returns (bytes32 pendingId) {
        uint256 funding = buy ? quantity * 2e6 / 1 ether : quantity;
        vm.startPrank(account);
        if (buy) dollar.approve(address(venue), funding);
        venue.deposit{value: buy ? 0 : funding}(account, buy ? address(dollar) : address(0), funding);
        tracker.beginOrder(creditId, buy ? buyRule : sellRule, quantity, 2e6);
        venue.place(quantity, 2e6, buy); tracker.finishOrder(creditId); vm.stopPrank();
        return keccak256(abi.encode(address(venue), venue.counter()));
    }
    function testPartialFillCancellationRefundPersistsAfterWithdrawal() public {
        bytes32 id = _place(true, 1 ether); assertEq(tracker.state(creditId, id).committed, 2e6);
        venue.fill(1, 0.4 ether); assertEq(tracker.state(creditId, id).filled, 800_000);
        vm.prank(account); tracker.beginCancel(creditId, address(venue), 1);
        assertEq(uint256(tracker.state(creditId, id).status), 2);
        vm.prank(account); venue.cancel(1);
        vm.prank(address(manager)); tracker.acknowledge(creditId, id);
        vm.prank(account); venue.withdraw(1_200_000, address(dollar));
        assertEq(tracker.state(creditId, id).refunded, 1_200_000);
        assertEq(tracker.state(creditId, id).filled, 800_000);
        assertEq(tracker.count(creditId), 0);
    }
    function testFullFillWithStaleOwnerAndSizeIsTerminal() public {
        bytes32 id = _place(true, 1 ether); venue.fill(1, 1 ether);
        assertEq(uint256(tracker.state(creditId, id).status), 3); assertEq(tracker.count(creditId), 0);
        assertEq(reader.pendingCount(creditId, account), 0);
        assertEq(reader.custodyBalance(creditId, account, 1), 1 ether);
    }
    function testCheckpointRefreshesAfterInterveningPartialFill() public {
        bytes32 id = _place(true, 1 ether);
        vm.prank(account); tracker.beginCancel(creditId, address(venue), 1);
        venue.fill(1, 0.5 ether); assertEq(uint256(tracker.state(creditId, id).status), 1);
        vm.prank(account); tracker.beginCancel(creditId, address(venue), 1);
        vm.prank(account); venue.cancel(1);
        assertEq(tracker.state(creditId, id).refunded, 1e6);
    }
    function testForeignOrdersAreNotCapturedAndUncontrolledCallsFail() public {
        vm.expectRevert(); tracker.beginOrder(creditId, buyRule, 1 ether, 2e6);
        _place(true, 1 ether);
        vm.deal(address(0xBAD), 1 ether); vm.prank(address(0xBAD)); venue.deposit{value: 1 ether}(address(0xBAD), address(0), 1 ether);
        vm.prank(address(0xBAD)); venue.place(1 ether, 2e6, false);
        assertEq(tracker.count(creditId), 1);
        vm.expectRevert(); tracker.beginCancel(creditId, address(venue), 2);
    }
    function testVenueCashAndLockedFundsAreCountedOnceAcrossFills() public {
        _place(true, 1 ether);
        (int256 beforeValue,,,) = reader.readAppValue(creditId, account, address(dollar));
        venue.fill(1, 0.5 ether);
        (int256 afterValue,,,) = reader.readAppValue(creditId, account, address(dollar));
        assertEq(beforeValue, 22e6); assertEq(afterValue, beforeValue);
    }
    function testNativeSellCommitmentsDoNotUseSettlementInputUnits() public {
        ExecutionTypes.Action memory action = _action(false, 1 ether);
        vm.prank(address(core)); ExecutionManager.Reservation memory reservation = manager.prepare(creditId, bundle, account, action);
        _place(false, 1 ether);
        bytes[] memory results = new bytes[](4);
        vm.prank(address(core)); manager.complete(creditId, bundle, account, action, reservation, results);
        assertEq(manager.pendingCount(creditId), 1);
    }
    function testCancellationReconcilesLedgerBeforeCheckingBounds() public {
        ExecutionTypes.Action memory buy = _action(true, 1 ether);
        vm.prank(address(core)); ExecutionManager.Reservation memory reservation = manager.prepare(creditId, bundle, account, buy);
        _place(true, 1 ether);
        vm.prank(address(core)); manager.complete(creditId, bundle, account, buy, reservation, new bytes[](4));
        venue.fill(1, 0.5 ether);
        ExecutionTypes.Action memory cancel; cancel.capability = keccak256("cancel"); cancel.market = market;
        cancel.calls = new ExecutionTypes.Call[](2);
        cancel.calls[0] = ExecutionTypes.Call(address(tracker), address(0), 0, abi.encodeCall(tracker.beginCancel, (creditId, address(venue), 1)), 0);
        cancel.calls[1] = ExecutionTypes.Call(address(venue), address(0), 0, abi.encodeCall(venue.cancel, (1)), 0);
        vm.prank(address(core)); reservation = manager.prepare(creditId, bundle, account, cancel);
        vm.startPrank(account); tracker.beginCancel(creditId, address(venue), 1); venue.cancel(1); vm.stopPrank();
        vm.prank(address(core)); manager.complete(creditId, bundle, account, cancel, reservation, new bytes[](2));
        assertEq(manager.pendingCount(creditId), 0); assertFalse(manager.breached(creditId));
        vm.prank(account); venue.withdraw(1e6, address(dollar));
        (, , , , ExecutionTypes.PendingState memory stored) = manager.records(creditId, keccak256(abi.encode(address(venue), uint256(1))));
        assertEq(stored.refunded, 1e6);
    }
    function testEightPendingOrdersRemainValuedWithinGasBudget() public {
        for (uint256 i; i < 8; ++i) _place(true, 0.1 ether);
        uint256 gasBefore = gasleft();
        (int256 value,,,) = reader.readAppValue(creditId, account, address(dollar));
        uint256 used = gasBefore - gasleft();
        assertEq(value, 21_600_000);
        assertLt(used, 8_000_000);
        assertEq(reader.pendingCount(creditId, account), 8);
    }

}
