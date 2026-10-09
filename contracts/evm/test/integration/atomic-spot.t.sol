// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {AccountFactory} from "../../src/monad/credit/AccountFactory.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {Types} from "../../src/shared/Types.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {HealthSource} from "../../src/monad/risk/HealthSource.sol";
import {AppHealthReaderFactory} from "../../src/monad/risk/AppHealthReaderFactory.sol";
import {IHealthReader, ICashReader, HealthReading} from "../../src/monad/risk/IHealthSource.sol";
import {OracleRegistry} from "../../src/monad/risk/OracleRegistry.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {AtomicSpotRouter} from "../../src/monad/integration/AtomicSpotRouter.sol";
import {AtomicSpotModule} from "../../src/monad/integration/AtomicSpotModule.sol";
import {ReadProgram} from "../../src/monad/integration/ReadProgram.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";
import {IAppExitPlanner} from "../../src/monad/integration/IAppExitPlanner.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";
import {PriceFeedFixture, PriceFeedGuardFixture} from "./price-protection.t.sol";

contract SpotDollar is MockERC20 { constructor() { decimals = 6; } }

contract KuruMarketFixture {
    MockERC20 public immutable base;
    MockERC20 public immutable quote;
    uint256 public marketState;
    uint32 public price = 20_000;
    uint96 public depth = 200e6;
    uint256 public fee;
    bool public steal;
    bool public recurse;
    constructor(MockERC20 base_, MockERC20 quote_) { base = base_; quote = quote_; }
    function setDepth(uint96 value) external { depth = value; }
    function setPrice(uint32 value) external { price = value; }
    function setFee(uint256 value) external { fee = value; }
    function pause() external { marketState = 1; }
    function setSteal(bool value) external { steal = value; }
    function setRecurse(bool value) external { recurse = value; }
    function getMarketParams() external view returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256) {
        return (10_000, 1e6, address(base), 18, address(quote), 6, 1, 1, type(uint96).max, fee, 0);
    }
    function getL2Book(uint32, uint32) external view returns (bytes memory) {
        return abi.encodePacked(block.number, uint256(price), uint256(depth), uint256(0));
    }
    function placeAndExecuteMarketBuy(uint96 amount, uint256 minimum, bool margin, bool fill) external {
        require(marketState == 0 && !margin && fill);
        uint256 input = uint256(amount) * 1e6 / 10_000;
        uint256 output = input * 10_000 * 1e12 / price;
        require(output >= minimum && quote.transferFrom(msg.sender, address(this), input));
        if (recurse) AtomicSpotRouter(payable(msg.sender)).trade(bytes32(0), 1, 1);
        require(base.transfer(steal ? address(0xBAD) : msg.sender, output));
    }
    function placeAndExecuteMarketSell(uint96 amount, uint256 minimum, bool margin, bool fill) external {
        require(marketState == 0 && !margin && fill && amount <= depth);
        uint256 input = uint256(amount) * 1e12;
        uint256 output = uint256(amount) * price / 10_000;
        output = output * (10_000 - fee) / 10_000;
        require(output >= minimum && base.transferFrom(msg.sender, address(this), input));
        require(quote.transfer(steal ? address(0xBAD) : msg.sender, output));
    }
}

contract SpotCollateralReader is IHealthReader, ICashReader {
    TermbookCore public immutable core;
    MockERC20 public immutable token;
    constructor(TermbookCore core_, MockERC20 token_) { core = core_; token = token_; }
    function readCash(bytes32 id, uint256) public view returns (uint256, uint256) {
        return (token.balanceOf(core.creditDetails(id).account), block.timestamp);
    }
    function readHealth(bytes32 id, uint256 revision, uint256 debt, address) external view returns (HealthReading memory) {
        (uint256 cash,) = readCash(id, revision);
        return HealthReading(debt, cash, core.creditDetails(id).collateralAmount, 0, 10_000, 0, 0, block.timestamp);
    }
}

contract AtomicSpotTest is CoreFixture {
    TermbookCore core;
    IntegrationRegistry registry;
    AtomicSpotRouter router;
    AtomicSpotModule module;
    ReadProgram quoter;
    bytes32 quoteProgram = keccak256("quote-program");
    OracleRegistry oracle;
    PriceFeedFixture feed;
    HealthSource health;
    SpotDollar usdc;
    MockERC20 base;
    KuruMarketFixture market;
    HouseVault houseVault;
    CollateralVault collateral;
    address borrower;
    address house;
    address account;
    uint256 borrowerKey = 0xCAFE;
    uint256 houseKey = 0xBEEF;
    bytes32 bundle = keccak256("atomic-spot");
    bytes32 buy = keccak256("buy");
    bytes32 sell = keccak256("sell");
    bytes32 buyRoute = keccak256("buy-route");
    bytes32 sellRoute = keccak256("sell-route");
    bytes32 marketId = keccak256("TOKEN-USDC");
    bytes32 feedId = keccak256("TOKEN/USD");
    bytes32 credit = keccak256("credit");
    bytes32 lockId = keccak256("lock");

    function setUp() public {
        vm.warp(1_000); vm.roll(10);
        borrower = vm.addr(borrowerKey); house = vm.addr(houseKey);
        usdc = new SpotDollar(); base = new MockERC20();
        core = _deployCore(address(this), address(this), address(0));
        core.setRisk(address(new RiskEngine(address(core))));
        registry = new IntegrationRegistry(address(this)); core.setIntegrationRegistry(address(registry));
        oracle = new OracleRegistry(address(this)); feed = new PriceFeedFixture(); feed.update(2e8);
        oracle.setFeed(feedId, address(feed), 60 days, 8);
        oracle.setFeedGuard(feedId, address(new PriceFeedGuardFixture(feed)));
        health = new HealthSource(address(this), address(oracle)); core.setHealthSource(address(health));
        market = new KuruMarketFixture(base, usdc);
        router = new AtomicSpotRouter(address(this), address(core), address(registry));
        module = new AtomicSpotModule(address(this), address(core), address(router), address(registry));
        quoter = new ReadProgram(address(this));
        bytes memory encoded = vm.parseJsonBytes(vm.readFile("test/fixtures/kuru-read.json"), ".program");
        ReadProgram.Program memory program = abi.decode(encoded, (ReadProgram.Program));
        program.queries[1].expectedHash = keccak256(abi.encode(uint32(10_000), uint96(1e6), address(base), uint256(18), address(usdc), uint256(6), uint32(1), uint96(1), type(uint96).max, uint256(0), uint256(0)));
        quoter.configure(quoteProgram, program);
        _configure();
        InboxFactory inbox = InboxFactory(deployCode("InboxFactory.sol:InboxFactory", abi.encode(address(this))));
        houseVault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(usdc), address(core), address(this), address(inbox), address(0))));
        usdc.mint(address(this), 10_000e6); usdc.approve(address(houseVault), 10_000e6); houseVault.deposit(address(this), 10_000e6);
        collateral = new CollateralVault(address(usdc), block.chainid, address(core));
        core.setLocalCollateralVault(address(collateral), address(collateral).codehash);
        _prepare();
        base.mint(address(market), 10_000 ether); usdc.mint(address(market), 10_000e6);
    }
    function _configure() internal {
        registry.approve(bundle, keccak256("definition"));
        address[7] memory pins = [address(router), address(module), address(quoter), address(market), address(base), address(usdc), address(oracle)];
        for (uint256 i; i < pins.length; ++i) registry.pinDependency(bundle, pins[i]);
        bytes32[] memory words = new bytes32[](4); words[3] = bytes32(uint256(1));
        router.configure(buyRoute, AtomicSpotRouter.Route(bundle, address(market), address(usdc), address(base), market.placeAndExecuteMarketBuy.selector, 0, 1, 10_000, 1e6, 1, type(uint96).max, words));
        router.configure(sellRoute, AtomicSpotRouter.Route(bundle, address(market), address(base), address(usdc), market.placeAndExecuteMarketSell.selector, 0, 1, 1e6, 1e18, 1, type(uint96).max, words));
        AtomicSpotModule.Market[] memory markets = new AtomicSpotModule.Market[](1);
        markets[0] = AtomicSpotModule.Market(marketId, buyRoute, sellRoute, address(quoter), 1_000 ether, address(oracle), feedId, 18, 6, buy, sell, 1e12, quoteProgram, 200e6);
        module.configure(bundle, address(usdc), 9_000, 0, markets);
        registry.registerCall(bundle, address(router), router.trade.selector, 100, 255, 1, 1_000 ether);
        registry.setCallValidator(bundle, address(router), router.trade.selector, address(module));
        registry.registerRecoveryCall(bundle, address(router), router.trade.selector, 100, 255);
        registry.setRecoveryCallValidator(bundle, address(router), router.trade.selector, address(module));
        registry.registerRecoveryCall(bundle, address(base), base.approve.selector, 68, 255);
        registry.setRecoveryCallValidator(bundle, address(base), base.approve.selector, address(module));
        _configureHooks();
    }
    function _configureHooks() internal virtual {
        core.configureExecutionPolicy(bundle, address(module), 1, 0, 60);
        core.setAppRecoveryAdapter(bundle, address(module)); core.setExitPlanner(bundle, address(module)); core.setExitVerifier(bundle, address(module));
        core.configureExecutionAmountPrice(bundle, buy, marketId, _rule(18), PriceProtection.AmountRule(1, 6, 18, true, false, true, address(usdc), address(base)));
        core.configureExecutionAmountPrice(bundle, sell, marketId, _rule(6), PriceProtection.AmountRule(1, 18, 6, false, false, true, address(base), address(usdc)));
        AppHealthReaderFactory factory = new AppHealthReaderFactory(address(core), address(new SpotCollateralReader(core, usdc)));
        address predicted = factory.predict(bundle, address(module), address(module));
        address reader = factory.create(bundle, address(module), address(module));
        assertEq(reader, predicted); assertEq(factory.create(bundle, address(module), address(module)), reader);
        health.setReader(bundle, reader, 1, 60); registry.activate(bundle);
    }
    function _rule(uint8 decimals) internal view returns (PriceProtection.Rule memory) {
        return PriceProtection.Rule(address(oracle), feedId, address(router), router.trade.selector, 0, decimals, 2, 0, 100, 500, 60, 0, 1);
    }
    function _prepare() internal {
        uint256 deadline = block.timestamp + 1 days; uint256 maturity = block.timestamp + 30 days;
        bytes32 intent = keccak256("intent"); bytes32 terms = keccak256("terms");
        bytes32 digest = core.quoteDigest(intent, borrower, house, address(houseVault), 200e6, maturity, false, bundle, deadline, 0, 0, 1, deadline, terms);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.startPrank(borrower);
        core.accept(credit, intent, borrower, house, address(houseVault), 200e6, maturity, false, bundle, deadline, 0, terms, 1, deadline, abi.encodePacked(r, s, v));
        usdc.mint(borrower, 100e6); usdc.approve(address(collateral), 100e6);
        core.setCollateral(credit, address(collateral), borrower); collateral.lock(lockId, credit, borrower, 100e6, borrower);
        core.bindCollateral(credit, lockId);
        account = new AccountFactory().create(credit, borrower, address(core)); core.bindAccount(credit, account);
        vm.stopPrank();
        core.configureRisk(credit, 13_000, 12_000, 11_800, 11_500, 11_000); core.recordHealth(credit);
    }
    function _action(bool buying, uint256 amount, uint256 bound) internal view returns (ExecutionTypes.Action memory action) {
        action.capability = buying ? buy : sell; action.market = marketId; action.requiredInput = buying ? amount : 0;
        action.exposureLimit = action.requiredInput;
        action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(router), buying ? address(usdc) : address(base), amount,
            abi.encodeCall(router.trade, (buying ? buyRoute : sellRoute, amount, bound)), 0);
    }
    function _execute(ExecutionTypes.Action memory action, uint256 drawAmount, uint256 nonce) internal {
        (uint256 price, uint256 at, uint80 round) = oracle.read(feedId);
        (, , uint256 bound) = abi.decode(_arguments(action.calls[0].data), (bytes32, uint256, uint256));
        TermbookCore.ExecutionAuthorization memory auth = TermbookCore.ExecutionAuthorization(drawAmount, drawAmount, nonce,
            block.timestamp + 60, core.creditRevision(credit), borrower, "", PriceProtection.Quote(round, price, at, block.timestamp, bound, 0, false));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, core.executionDigest(credit, action, auth));
        auth.signature = abi.encodePacked(r, s, v); core.executePlan(credit, action, auth);
    }
    function _arguments(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(96); for (uint256 i; i < 96; ++i) out[i] = data[i + 4];
    }
    function _buy() internal { _execute(_action(true, 200e6, 100 ether), 200e6, 1); }
    function attemptBuy() external { _buy(); }
    function attemptUnpriced() external {
        ExecutionTypes.Action memory action = _action(true, 200e6, 1); action.capability = keccak256("unpriced");
        _execute(action, 200e6, 1);
    }
    function testBorrowTradeSellRepayAndRelease() public {
        _buy(); assertEq(base.balanceOf(account), 100 ether); assertEq(usdc.balanceOf(account), 0);
        assertEq(core.creditDetails(credit).debt, 200e6); assertEq(module.positionCount(credit, account), 1);
        assertEq(usdc.allowance(account, address(router)), 0); assertEq(CreditAccount(payable(account)).activeAllowances(), 0);
        _execute(_action(false, 100 ether, 200e6), 0, 2);
        assertEq(base.balanceOf(account), 0); assertEq(usdc.balanceOf(account), 200e6);
        vm.startPrank(borrower);
        core.repayFromAccount(credit, 200e6); core.startClosing(credit); core.authorizeReturn(credit, lockId, 100e6); core.finishClose(credit);
        vm.stopPrank();
        assertTrue(CreditAccount(payable(account)).released()); assertEq(uint256(core.creditFacility(credit)), uint256(Types.Facility.Closed));
    }
    function testBorrowerClosureSellsWithAtomicApproval() public {
        _buy(); vm.prank(borrower); core.startClosing(credit);
        (bytes32 step,, bool done,) = core.closeStep(credit); assertFalse(done);
        vm.prank(borrower); core.advanceClose(credit, step);
        assertEq(usdc.balanceOf(account), 200e6); assertTrue(module.canExit(credit, account));
        assertEq(base.allowance(account, address(router)), 0); assertEq(CreditAccount(payable(account)).activeAllowances(), 0);
        vm.prank(borrower); vm.expectRevert(); core.advanceClose(credit, step);
    }
    function testPartialKeeperRecoveryApprovesSellsAndRepaysAtomically() public {
        _buy(); market.setPrice(10_000); feed.update(1e8); core.recordHealth(credit);
        core.setRecoveryKeeper(address(this), true); core.startLiquidation(credit); assertFalse(core.fullTermination(credit));
        (, bytes memory instruction,) = IAppExitPlanner(core.exitPlannerOfBundle(bundle)).nextExitStep(credit, account); core.recoverApp(credit, instruction);
        assertEq(core.creditDetails(credit).debt, 100e6); assertEq(usdc.balanceOf(account), 0);
        assertEq(base.balanceOf(account), 0); assertEq(base.allowance(account, address(router)), 0);
        assertEq(CreditAccount(payable(account)).activeAllowances(), 0);
    }
    function testDefaultKeeperClosesWithoutBorrower() public {
        _buy(); vm.warp(block.timestamp + 31 days); feed.update(2e8);
        core.setRecoveryKeeper(address(this), true); core.markDefaulted(credit); core.startLiquidation(credit);
        (, bytes memory instruction,) = IAppExitPlanner(core.exitPlannerOfBundle(bundle)).nextExitStep(credit, account); core.recoverApp(credit, instruction);
        core.recoverAccountCash(credit, 200e6); assertEq(core.creditDetails(credit).debt, 0); assertTrue(module.canExit(credit, account));
    }
    function testWrongRecipientAndReentrancyRollBackBorrowing() public {
        market.setSteal(true); vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDetails(credit).debt, 0);
        market.setSteal(false); market.setRecurse(true); vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDetails(credit).debt, 0);
        assertEq(base.balanceOf(address(0xBAD)), 0); assertEq(usdc.balanceOf(address(router)), 0);
    }
    function testMissingPriceRuleCannotBypassProtection() public {
        vm.expectRevert(); this.attemptUnpriced(); assertEq(core.creditDetails(credit).debt, 0);
    }
    function testDepthLimitsRecoverableValueAndStopsUnsafeDraw() public {
        market.setDepth(10e6); vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDetails(credit).debt, 0);
        (uint256 amount, uint256 proceeds) = quoter.quote(quoteProgram, address(market), 100 ether); assertEq(amount, 10 ether); assertEq(proceeds, 20e6);
    }
    function testParameterChangePauseAndStaleOracleFailClosed() public {
        market.setFee(1); vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDetails(credit).debt, 0);
        market.setFee(0); market.pause(); (uint256 amount, uint256 proceeds) = quoter.quote(quoteProgram, address(market), 100 ether);
        assertEq(amount, 0); assertEq(proceeds, 0);
    }
    function testRouterReservesCannotBeTakenByAnotherAccount() public {
        usdc.mint(address(router), 1e6); base.mint(address(router), 1 ether);
        _buy(); assertEq(usdc.balanceOf(address(router)), 1e6); assertEq(base.balanceOf(address(router)), 1 ether);
        assertEq(base.balanceOf(account), 100 ether);
    }
    function testMarketReadGasIsBounded() public {
        vm.mockCallRevert(address(market), abi.encodeWithSignature("getL2Book(uint32,uint32)", uint32(16), uint32(0)), "");
        (uint256 amount, uint256 proceeds) = quoter.quote(quoteProgram, address(market), 100 ether); assertEq(amount, 0); assertEq(proceeds, 0);
    }
    function testStaleOracleBlocksTheLoan() public {
        vm.warp(block.timestamp + 61 days); vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDetails(credit).debt, 0);
    }
    function testDustHasNoCreditValueAndDoesNotTrapDebtFreeClosure() public {
        base.mint(account, 1e12);
        (int256 value,,,) = module.readAppValue(credit, account, address(usdc)); assertEq(value, 0);
        assertEq(module.positionCount(credit, account), 0); assertTrue(module.canExit(credit, account));
        vm.startPrank(borrower); core.startClosing(credit); core.authorizeReturn(credit, lockId, 100e6); core.finishClose(credit); vm.stopPrank();
        assertTrue(CreditAccount(payable(account)).released()); assertEq(base.balanceOf(account), 1e12);
    }
    function testDonationsAboveHoldingCapRemainRecoverable() public {
        base.mint(account, 1500 ether);
        (int256 value,,,) = module.readAppValue(credit, account, address(usdc)); assertEq(value, 400e6);
        core.recordHealth(credit);
        vm.prank(borrower); core.startClosing(credit);
        (bytes32 step,, bool done,) = core.closeStep(credit); assertFalse(done);
        vm.prank(borrower); core.advanceClose(credit, step);
        assertEq(base.balanceOf(account), 1300 ether); assertEq(usdc.balanceOf(account), 400e6);
        assertEq(base.allowance(account, address(router)), 0);
    }
}
