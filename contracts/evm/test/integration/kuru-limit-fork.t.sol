// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KuruForkFixture, IKuruForkFactory} from "./kuru-fork.t.sol";
import {SpotCollateralReader} from "./atomic-spot.t.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {AtomicSpotRouter} from "../../src/monad/integration/AtomicSpotRouter.sol";
import {UseCaseReader} from "../../src/monad/integration/UseCaseReader.sol";
import {UseCasePolicy} from "../../src/monad/integration/UseCasePolicy.sol";
import {UseCaseRecovery} from "../../src/monad/integration/UseCaseRecovery.sol";
import {SpotOrderTracker} from "../../src/monad/integration/SpotOrderTracker.sol";
import {ReadProgram} from "../../src/monad/integration/ReadProgram.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";
import {AppHealthReaderFactory} from "../../src/monad/risk/AppHealthReaderFactory.sol";

interface ILimitBook {
    function s_orderIdCounter() external view returns (uint40);
    function addBuyOrder(uint32,uint96,bool) external;
    function addSellOrder(uint32,uint96,bool) external;
    function batchCancelOrders(uint40[] calldata) external;
    function placeAndExecuteMarketSell(uint96,uint256,bool,bool) external payable returns(uint256);
}
interface ILimitMargin {
    function deposit(address,address,uint256) external payable;
    function withdraw(uint256,address) external;
    function getBalance(address,address) external view returns(uint256);
}

contract KuruLimitForkTest is KuruForkFixture {
    SpotOrderTracker tracker;
    UseCaseReader reader;
    UseCasePolicy policy;
    UseCaseRecovery recovery;
    address margin;
    bytes32 constant LIMIT_BUY = keccak256("limit-buy");
    bytes32 constant LIMIT_SELL = keccak256("limit-sell");
    bytes32 constant CANCEL = keccak256("cancel");
    bytes32 constant BUY_RULE = keccak256("tracked-buy");
    bytes32 constant SELL_RULE = keccak256("tracked-sell");

    function _readProgram(string memory key) private returns (bytes32 id) {
        ReadProgram.Program memory program = abi.decode(vm.parseJsonBytes(vm.readFile("test/fixtures/kuru-testnet-read.json"), key), (ReadProgram.Program));
        id = keccak256(abi.encode(program)); quoter.configure(id, program);
    }
    function _word(UseCasePolicy.Kind kind, uint256 maximum) private pure returns (UseCasePolicy.Word memory) {
        return UseCasePolicy.Word(kind, bytes32(0), 0, maximum);
    }
    function _call(address target, bytes4 selector, uint256 count) private pure returns (UseCasePolicy.Call memory call_) {
        call_ = UseCasePolicy.Call(target, selector, true, new UseCasePolicy.Word[](count), 0, 255);
        for (uint256 j; j < count; ++j) call_.words[j] = _word(UseCasePolicy.Kind.Range, type(uint256).max);
    }
    function _configure() internal override {
        _guardDependencies(); margin = IKuruForkFactory(FACTORY).marginAccountAddress();
        tracker = SpotOrderTracker(deployCode("SpotOrderTracker.sol:SpotOrderTracker", abi.encode(address(this), address(core), address(registry), address(quoter))));
        reader = UseCaseReader(deployCode("UseCaseReader.sol:UseCaseReader", abi.encode(address(this), address(core), address(registry), address(quoter))));
        policy = UseCasePolicy(deployCode("UseCasePolicy.sol:UseCasePolicy", abi.encode(address(this), address(core), address(reader))));
        recovery = UseCaseRecovery(deployCode("UseCaseRecovery.sol:UseCaseRecovery", abi.encode(address(this), address(core), address(reader))));
        address[7] memory pins = [address(tracker), address(reader), address(policy), address(recovery), address(router), address(quoter), address(oracle)];
        for (uint256 i; i < pins.length; ++i) registry.pinDependency(BUNDLE, pins[i]);
        bytes32 counterProgram = _readProgram(".counter");
        bytes32 stateProgram = _readProgram(".order");
        bytes32 balanceProgram = _readProgram(".balance");
        SpotOrderTracker.Rule[] memory rules = new SpotOrderTracker.Rule[](2);
        rules[0] = SpotOrderTracker.Rule(BUY_RULE, MARKET_ID, MARKET, USDC, margin, counterProgram, stateProgram, balanceProgram, 100_000, 1 ether, true);
        rules[1] = SpotOrderTracker.Rule(SELL_RULE, MARKET_ID, MARKET, address(0), margin, counterProgram, stateProgram, balanceProgram, 1 ether, 1 ether, false);
        tracker.configure(BUNDLE, rules);
        UseCaseReader.Config memory config; config.settlement = USDC; config.orderTracker = address(tracker);
        config.retainedBps = 9_500; config.maxPositions = 3; config.maxPending = 4;
        config.assets = new UseCaseReader.Asset[](1);
        config.assets[0] = UseCaseReader.Asset(address(0), address(oracle), FEED, 18, 1 ether, 1e10, PROGRAM, MARKET);
        config.markets = new UseCaseReader.Market[](1); config.markets[0] = UseCaseReader.Market(MARKET_ID, address(0), config.assets[0], config.assets[0], 100_000);
        config.custody = new UseCaseReader.Custody[](2);
        config.custody[0] = UseCaseReader.Custody(margin, balanceProgram, USDC, 100_000, 0);
        config.custody[1] = UseCaseReader.Custody(margin, balanceProgram, address(0), 1 ether, 0);
        reader.configure(BUNDLE, config);
        _configureActions(); _configureRecovery();
        bytes32[] memory words = new bytes32[](4); words[3] = bytes32(uint256(1));
        router.configure(SELL_ROUTE, AtomicSpotRouter.Route(BUNDLE, MARKET, address(0), USDC,
            bytes4(keccak256("placeAndExecuteMarketSell(uint96,uint256,bool,bool)")), 0, 1, 1e10, 1e18, 1, type(uint96).max, words));
        core.configureExecutionPolicy(BUNDLE, address(policy), 3, 4, 60);
        core.setAppRecoveryAdapter(BUNDLE, address(recovery)); core.setExitPlanner(BUNDLE, address(recovery)); core.setExitVerifier(BUNDLE, address(recovery));
        PriceProtection.Rule memory priceRule = PriceProtection.Rule(address(oracle), FEED, address(tracker), tracker.beginOrder.selector,
            1, 8, 3, 1, 100, 500, 60, uint256(BUY_RULE), uint256(SELL_RULE));
        core.configureExecutionPrice(BUNDLE, LIMIT_BUY, MARKET_ID, priceRule); core.configureExecutionPrice(BUNDLE, LIMIT_SELL, MARKET_ID, priceRule);
        AppHealthReaderFactory factory = AppHealthReaderFactory(deployCode("AppHealthReaderFactory.sol:AppHealthReaderFactory",
            abi.encode(address(core), address(new SpotCollateralReader(core, MockERC20(USDC))))));
        health.setReader(BUNDLE, factory.create(BUNDLE, address(reader), address(recovery)), 1, 60);
        registry.activate(BUNDLE);
    }
    function _configureActions() private {
        UseCasePolicy.Call[] memory calls = new UseCasePolicy.Call[](9);
        calls[0] = _call(margin, ILimitMargin.deposit.selector, 3); calls[0].words[0] = _word(UseCasePolicy.Kind.Account, 0);
        calls[0].maximumNative = 1 ether;
        calls[1] = _call(address(tracker), tracker.beginOrder.selector, 4); calls[1].words[0] = _word(UseCasePolicy.Kind.Credit, 0);
        calls[2] = _call(MARKET, ILimitBook.addBuyOrder.selector, 3);
        calls[3] = _call(address(tracker), tracker.finishOrder.selector, 1); calls[3].words[0] = _word(UseCasePolicy.Kind.Credit, 0);
        calls[4] = _call(address(tracker), tracker.beginCancel.selector, 3); calls[4].words[0] = _word(UseCasePolicy.Kind.Credit, 0);
        calls[5] = _call(MARKET, ILimitBook.batchCancelOrders.selector, 3);
        calls[6] = _call(margin, ILimitMargin.withdraw.selector, 2);
        calls[7] = _call(address(router), router.trade.selector, 3); calls[7].maximumNative = 1 ether; calls[7].nativeWord = 1;
        calls[8] = _call(MARKET, ILimitBook.addSellOrder.selector, 3);
        UseCasePolicy.Action[] memory actions = new UseCasePolicy.Action[](3);
        for (uint256 i; i < 2; ++i) {
            UseCasePolicy.Call[] memory placement = new UseCasePolicy.Call[](4);
            placement[0] = calls[0]; placement[1] = calls[1]; placement[2] = calls[2]; placement[3] = calls[3];
            if (i == 1) placement[2] = calls[8];
            actions[i] = UseCasePolicy.Action(i == 0 ? LIMIT_BUY : LIMIT_SELL, MARKET_ID, keccak256("place_order"), i == 0 ? 100_000 : 0, i == 0 ? 100_000 : 0, true, placement);
        }
        UseCasePolicy.Call[] memory cancel = new UseCasePolicy.Call[](2); cancel[0] = calls[4]; cancel[1] = calls[5];
        actions[2] = UseCasePolicy.Action(CANCEL, MARKET_ID, keccak256("cancel_order"), 0, 0, false, cancel);
        policy.configure(BUNDLE, actions, calls);
        for (uint256 i; i < calls.length; ++i) {
            registry.registerCall(BUNDLE, calls[i].target, calls[i].selector, 4 + calls[i].words.length * 32, 255, 255, 0);
            registry.setCallValidator(BUNDLE, calls[i].target, calls[i].selector, address(policy));
            registry.registerRecoveryCall(BUNDLE, calls[i].target, calls[i].selector, 4 + calls[i].words.length * 32, 255);
            registry.setRecoveryCallValidator(BUNDLE, calls[i].target, calls[i].selector, address(policy));
        }
        registry.registerNativeValue(BUNDLE, margin, ILimitMargin.deposit.selector, false, 1 ether, 255);
        registry.registerNativeValue(BUNDLE, address(router), router.trade.selector, true, 1 ether, 1);
    }
    function _configureRecovery() private {
        UseCaseRecovery.Template[] memory templates = new UseCaseRecovery.Template[](5);
        UseCaseRecovery.Word[] memory words = new UseCaseRecovery.Word[](3);
        words[0] = UseCaseRecovery.Word(UseCaseRecovery.Source.Credit, bytes32(0));
        words[1] = UseCaseRecovery.Word(UseCaseRecovery.Source.Literal, bytes32(uint256(uint160(MARKET))));
        words[2] = UseCaseRecovery.Word(UseCaseRecovery.Source.Field, bytes32(uint256(7)));
        templates[0] = UseCaseRecovery.Template(UseCaseRecovery.Phase.Pending, MARKET_ID, address(tracker), tracker.beginCancel.selector, words, address(0), USDC, 255, 255, true, 1);
        words = new UseCaseRecovery.Word[](3); words[0] = UseCaseRecovery.Word(UseCaseRecovery.Source.Literal, bytes32(uint256(32)));
        words[1] = UseCaseRecovery.Word(UseCaseRecovery.Source.Literal, bytes32(uint256(1))); words[2] = UseCaseRecovery.Word(UseCaseRecovery.Source.Field, bytes32(uint256(7)));
        templates[1] = UseCaseRecovery.Template(UseCaseRecovery.Phase.Pending, MARKET_ID, MARKET, ILimitBook.batchCancelOrders.selector, words, address(0), USDC, 255, 255, true, 2);
        for (uint256 i; i < 2; ++i) {
            address token = i == 0 ? USDC : address(0); words = new UseCaseRecovery.Word[](2);
            words[0] = UseCaseRecovery.Word(UseCaseRecovery.Source.Field, bytes32(uint256(1))); words[1] = UseCaseRecovery.Word(UseCaseRecovery.Source.Literal, bytes32(uint256(uint160(token))));
            templates[2 + i] = UseCaseRecovery.Template(UseCaseRecovery.Phase.Custody, bytes32(uint256(uint160(token))), margin,
                ILimitMargin.withdraw.selector, words, address(0), token, 255, 1, false, 0);
        }
        words = new UseCaseRecovery.Word[](3); words[0] = UseCaseRecovery.Word(UseCaseRecovery.Source.Literal, SELL_ROUTE);
        words[1] = UseCaseRecovery.Word(UseCaseRecovery.Source.Field, bytes32(uint256(1))); words[2] = UseCaseRecovery.Word(UseCaseRecovery.Source.Minimum, bytes32(0));
        templates[4] = UseCaseRecovery.Template(UseCaseRecovery.Phase.Holding, bytes32(0), address(router), router.trade.selector,
            words, address(0), USDC, 1, 2, false, 0);
        recovery.configure(BUNDLE, templates);
    }
    function _executeManaged(ExecutionTypes.Action memory action, uint256 draw, uint256 nonce, uint256 bound, bool buy) private {
        (uint256 price, uint256 at, uint80 round) = oracle.read(FEED);
        PriceProtection.Quote memory quote = bound == 0 ? PriceProtection.Quote(0,0,0,0,0,0,false)
            : PriceProtection.Quote(round, price, at, block.timestamp, bound, 0, buy);
        TermbookCore.ExecutionAuthorization memory auth = TermbookCore.ExecutionAuthorization(draw, draw, nonce,
            block.timestamp + 60, core.creditRevision(CREDIT), borrower, "", quote);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BORROWER_KEY, core.executionDigest(CREDIT, action, auth));
        auth.signature = abi.encodePacked(r,s,v); core.executePlan(CREDIT, action, auth);
    }
    function _limit(bool buy, uint96 size, uint32 price, uint256 nonce) private returns (uint40 id) {
        uint256 input = buy ? DRAW : uint256(size) * 1e8;
        ExecutionTypes.Action memory action; action.capability = buy ? LIMIT_BUY : LIMIT_SELL; action.market = MARKET_ID;
        action.requiredInput = buy ? input : 0; action.exposureLimit = action.requiredInput; action.calls = new ExecutionTypes.Call[](4);
        action.calls[0] = ExecutionTypes.Call(margin, buy ? USDC : address(0), buy ? input : 0,
            abi.encodeCall(ILimitMargin.deposit, (account, buy ? USDC : address(0), input)), buy ? 0 : input);
        action.calls[1] = ExecutionTypes.Call(address(tracker), address(0), 0,
            abi.encodeCall(tracker.beginOrder, (CREDIT, buy ? BUY_RULE : SELL_RULE, uint256(size) * 1e8, price)), 0);
        action.calls[2] = ExecutionTypes.Call(MARKET, address(0), 0,
            abi.encodeWithSelector(buy ? ILimitBook.addBuyOrder.selector : ILimitBook.addSellOrder.selector, price, size, false), 0);
        action.calls[3] = ExecutionTypes.Call(address(tracker), address(0), 0, abi.encodeCall(tracker.finishOrder, (CREDIT)), 0);
        _executeManaged(action, buy ? input : 0, nonce, price, buy); return ILimitBook(MARKET).s_orderIdCounter();
    }
    function _buyLimit() private returns (uint40 id, uint96 size) {
        uint32 price = uint32(ask - 100); size = uint96(DRAW * 1e12 / price);
        id = _limit(true, size, price, 1); assertEq(core.creditDebt(CREDIT), DRAW);
        assertEq(reader.pendingCount(CREDIT, account), 1); assertEq(core.executionManager().pendingCount(CREDIT), 1);
        assertEq(MockERC20(USDC).allowance(account, margin), 0); assertGt(core.previewHealth(CREDIT).appValue, 0);
    }
    function _fill(uint96 size) private {
        address taker = address(0xFACE); vm.deal(taker, uint256(size) * 1e8);
        vm.prank(taker); ILimitBook(MARKET).placeAndExecuteMarketSell{value: uint256(size) * 1e8}(size, 1, false, true);
    }
    function testForkLimitPartialFillClosureRepaymentAndReturn() public {
        (uint40 id, uint96 size) = _buyLimit(); _fill(size / 2);
        bytes32 pendingId = keccak256(abi.encode(MARKET, uint256(id)));
        assertGt(tracker.state(CREDIT, pendingId).filled, 0); assertGt(ILimitMargin(margin).getBalance(account, address(0)), 0);
        feed.update(int256(bid - 1)); vm.prank(borrower); core.startClosing(CREDIT);
        for (uint256 i; i < 8 && !recovery.canExit(CREDIT, account); ++i) {
            (bytes32 step,, bool done,) = core.closeStep(CREDIT); assertFalse(done);
            vm.prank(borrower); core.advanceClose(CREDIT, step);
        }
        assertTrue(recovery.canExit(CREDIT, account)); assertEq(core.executionManager().pendingCount(CREDIT), 0);
        vm.startPrank(borrower); core.repayAvailableCash(CREDIT);
        uint256 remaining = core.creditDebt(CREDIT); MockERC20(USDC).approve(address(core), remaining); core.repay(CREDIT, remaining);
        core.authorizeReturn(CREDIT, LOCK, COLLATERAL); core.finishClose(CREDIT); vm.stopPrank();
        assertEq(core.creditDebt(CREDIT), 0); assertTrue(CreditAccount(payable(account)).released());
    }
    function testForkLimitFullFillReconcilesStaleOrderFields() public {
        (, uint96 size) = _buyLimit(); _fill(size + 1_000_000);
        assertEq(reader.pendingCount(CREDIT, account), 0);
        assertGt(ILimitMargin(margin).getBalance(account, address(0)), 0);
        feed.update(int256(bid - 1)); vm.prank(borrower); core.startClosing(CREDIT);
        for (uint256 i; i < 5 && !recovery.canExit(CREDIT, account); ++i) {
            (bytes32 step,,,) = core.closeStep(CREDIT); vm.prank(borrower); core.advanceClose(CREDIT, step);
        }
        assertTrue(recovery.canExit(CREDIT, account)); assertEq(core.executionManager().pendingCount(CREDIT), 0);
    }
    function testForkNativeLimitSellCancellationReturnsControlledFunds() public {
        vm.deal(account, 0.01 ether); feed.update(int256(bid - 1));
        uint96 size = 50_000_000;
        uint40 id = _limit(false, size, uint32(ask + 100), 1);
        bytes32 pendingId = keccak256(abi.encode(MARKET, uint256(id)));
        assertEq(tracker.state(CREDIT, pendingId).committed, uint256(size) * 1e8);
        assertEq(core.creditDebt(CREDIT), 0);
        ExecutionTypes.Action memory action; action.capability = CANCEL; action.market = MARKET_ID;
        action.calls = new ExecutionTypes.Call[](2);
        action.calls[0] = ExecutionTypes.Call(address(tracker), address(0), 0,
            abi.encodeCall(tracker.beginCancel, (CREDIT, MARKET, uint256(id))), 0);
        uint40[] memory ids = new uint40[](1); ids[0] = id;
        action.calls[1] = ExecutionTypes.Call(MARKET, address(0), 0, abi.encodeCall(ILimitBook.batchCancelOrders, (ids)), 0);
        _executeManaged(action, 0, 2, 0, false);
        assertEq(core.executionManager().pendingCount(CREDIT), 0);
        assertEq(ILimitMargin(margin).getBalance(account, address(0)), uint256(size) * 1e8);
        vm.prank(borrower); core.startClosing(CREDIT);
        for (uint256 i; i < 5 && !recovery.canExit(CREDIT, account); ++i) {
            (bytes32 step,,,) = core.closeStep(CREDIT); vm.prank(borrower); core.advanceClose(CREDIT, step);
        }
        assertTrue(recovery.canExit(CREDIT, account));
        assertEq(ILimitMargin(margin).getBalance(account, address(0)), 0);
    }
    function testForkKeeperCancelsAndWithdrawsWithoutBorrower() public {
        (, uint96 size) = _buyLimit(); _fill(size / 2);
        vm.warp(block.timestamp + 31 days); _renew(); feed.update(int256(bid - 1));
        address keeper = address(0xB0B); core.setRecoveryKeeper(keeper, true); core.markDefaulted(CREDIT); core.startLiquidation(CREDIT);
        for (uint256 i; i < 8 && !recovery.canExit(CREDIT, account); ++i) {
            (, bytes memory instruction,) = recovery.nextExitStep(CREDIT, account);
            vm.prank(keeper); core.recoverApp(CREDIT, instruction);
        }
        assertTrue(recovery.canExit(CREDIT, account)); assertEq(core.executionManager().pendingCount(CREDIT), 0);
        vm.startPrank(keeper); core.recoverAccountCash(CREDIT, MockERC20(USDC).balanceOf(account));
        uint256 shortfall = core.creditDebt(CREDIT); assertLt(shortfall, COLLATERAL); core.recoverCollateral(CREDIT, shortfall); vm.stopPrank();
        assertEq(core.creditDebt(CREDIT), 0);
    }
}
