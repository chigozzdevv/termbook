// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {MockERC20} from "../MockERC20.sol";
import {SpotCollateralReader} from "./atomic-spot.t.sol";
import {PriceFeedFixture, PriceFeedGuardFixture} from "./price-protection.t.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {AccountFactory} from "../../src/monad/credit/AccountFactory.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {Types} from "../../src/shared/Types.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {HealthSource} from "../../src/monad/risk/HealthSource.sol";
import {OracleRegistry} from "../../src/monad/risk/OracleRegistry.sol";
import {AppHealthReaderFactory} from "../../src/monad/risk/AppHealthReaderFactory.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {AtomicSpotRouter} from "../../src/monad/integration/AtomicSpotRouter.sol";
import {AtomicSpotModule} from "../../src/monad/integration/AtomicSpotModule.sol";
import {ReadProgram} from "../../src/monad/integration/ReadProgram.sol";
import {TestnetUpgradeGuard} from "../../src/monad/integration/TestnetUpgradeGuard.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";

interface IKuruForkMarket {
    function getMarketParams() external view returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256);
    function getL2Book(uint32, uint32) external view returns (bytes memory);
    function kuruAmmVault() external view returns (address);
}

interface IKuruForkFactory {
    function marginAccountAddress() external view returns (address);
    function TRUSTED_FORWARDER() external view returns (address);
}

abstract contract KuruForkFixture is CoreFixture {
    address constant MARKET = 0x1F57a841540fe23C2989387c18F2CB1335CBAe92;
    address constant FACTORY = 0x7EFbE105Ca7415dE98F96622173458ac1c054630;
    address constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 constant LEGACY_IMPLEMENTATION_SLOT = 0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3;
    bytes32 constant BUNDLE = keccak256("kuru-fork");
    bytes32 constant BUY = keccak256("kuru_buy");
    bytes32 constant SELL = keccak256("kuru_sell");
    bytes32 constant BUY_ROUTE = keccak256("kuru-fork-buy");
    bytes32 constant SELL_ROUTE = keccak256("kuru-fork-sell");
    bytes32 constant MARKET_ID = keccak256("kuru-fork-market");
    bytes32 constant PROGRAM = keccak256("kuru-fork-read");
    bytes32 constant FEED = keccak256("MON/USDC");
    bytes32 constant CREDIT = keccak256("kuru-fork-credit");
    bytes32 constant LOCK = keccak256("kuru-fork-lock");
    uint256 constant BORROWER_KEY = 0xCAFE;
    uint256 constant HOUSE_KEY = 0xBEEF;
    uint256 constant DRAW = 10_000;
    uint256 constant COLLATERAL = 5_000;
    TermbookCore core;
    IntegrationRegistry registry;
    AtomicSpotRouter router;
    AtomicSpotModule module;
    ReadProgram quoter;
    OracleRegistry oracle;
    PriceFeedFixture feed;
    HealthSource health;
    HouseVault vault;
    CollateralVault collateral;
    address borrower;
    address account;
    uint256 bid;
    uint256 ask;
    TestnetUpgradeGuard[] guards;

    function setUp() public {
        string memory rpc = vm.envOr("KURU_FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        uint256 sourceBlock = vm.envOr("KURU_FORK_BLOCK", uint256(0));
        if (sourceBlock == 0) vm.createSelectFork(rpc); else vm.createSelectFork(rpc, sourceBlock);
        assertEq(block.chainid, 10143);
        assertGt(MARKET.code.length, 0);
        (uint32 price, uint96 size, address base, uint256 baseDecimals, address quote, uint256 quoteDecimals,,,,,) = IKuruForkMarket(MARKET).getMarketParams();
        assertEq(price, 1e8); assertEq(size, 1e10); assertEq(base, address(0));
        assertEq(baseDecimals, 18); assertEq(quote, USDC); assertEq(quoteDecimals, 6);
        bytes memory book = IKuruForkMarket(MARKET).getL2Book(1, 1);
        assertEq(book.length, 192);
        assembly ("memory-safe") { sstore(bid.slot, mload(add(book, 64))) sstore(ask.slot, mload(add(book, 160))) }
        assertGt(bid, 1); assertGt(ask, bid);

        borrower = vm.addr(BORROWER_KEY);
        core = _deployCore(address(this), address(this), address(0));
        core.setRisk(deployCode("RiskEngine.sol:RiskEngine", abi.encode(address(core))));
        registry = IntegrationRegistry(deployCode("IntegrationRegistry.sol:IntegrationRegistry", abi.encode(address(this)))); core.setIntegrationRegistry(address(registry));
        oracle = OracleRegistry(deployCode("OracleRegistry.sol:OracleRegistry", abi.encode(address(this)))); feed = new PriceFeedFixture(); feed.update(int256(ask + 1));
        oracle.setFeed(FEED, address(feed), 60, 8);
        oracle.setFeedGuard(FEED, address(new PriceFeedGuardFixture(feed)));
        health = HealthSource(deployCode("HealthSource.sol:HealthSource", abi.encode(address(this), address(oracle)))); core.setHealthSource(address(health));
        router = AtomicSpotRouter(payable(deployCode("AtomicSpotRouter.sol:AtomicSpotRouter", abi.encode(address(this), address(core), address(registry)))));
        module = AtomicSpotModule(deployCode("AtomicSpotModule.sol:AtomicSpotModule", abi.encode(address(this), address(core), address(router), address(registry))));
        quoter = ReadProgram(deployCode("ReadProgram.sol:ReadProgram", abi.encode(address(this))));
        ReadProgram.Program memory program = abi.decode(vm.parseJsonBytes(vm.readFile("test/fixtures/kuru-testnet-read.json"), ".program"), (ReadProgram.Program));
        (bool ok, bytes memory parameters) = MARKET.staticcall(abi.encodeCall(IKuruForkMarket.getMarketParams, ()));
        assertTrue(ok); program.queries[1].expectedHash = keccak256(parameters); quoter.configure(PROGRAM, program);
        _configure();
        InboxFactory inbox = InboxFactory(deployCode("InboxFactory.sol:InboxFactory", abi.encode(address(this))));
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(USDC, address(core), address(this), address(inbox), address(0))));
        deal(USDC, address(this), 100e6); MockERC20(USDC).approve(address(vault), 100e6); vault.deposit(address(this), 100e6);
        collateral = CollateralVault(deployCode("CollateralVault.sol:CollateralVault", abi.encode(USDC, block.chainid, address(core))));
        core.setLocalCollateralVault(address(collateral), address(collateral).codehash);
        _prepare();
    }

    function _guardDependencies() internal {
        registry.approve(BUNDLE, keccak256("fork-definition"));
        address[6] memory proxies = [MARKET, FACTORY, IKuruForkMarket(MARKET).kuruAmmVault(), IKuruForkFactory(FACTORY).marginAccountAddress(), IKuruForkFactory(FACTORY).TRUSTED_FORWARDER(), USDC];
        for (uint256 i; i < proxies.length; ++i) {
            address implementation = address(uint160(uint256(vm.load(proxies[i], IMPLEMENTATION_SLOT))));
            if (implementation == address(0)) implementation = address(uint160(uint256(vm.load(proxies[i], LEGACY_IMPLEMENTATION_SLOT))));
            assertGt(implementation.code.length, 0);
            TestnetUpgradeGuard guard = TestnetUpgradeGuard(deployCode("TestnetUpgradeGuard.sol:TestnetUpgradeGuard", abi.encode(proxies[i], implementation, address(this), address(this))));
            guards.push(guard); registry.pinDependency(BUNDLE, proxies[i]);
        }
        _renew();
        for (uint256 i; i < proxies.length; ++i) registry.setDependencyGuard(BUNDLE, proxies[i], address(guards[i]));
    }

    function _configure() internal virtual {
        _guardDependencies();
        address[5] memory pins = [address(router), address(module), address(quoter), USDC, address(oracle)];
        for (uint256 i; i < pins.length; ++i) registry.pinDependency(BUNDLE, pins[i]);
        bytes32[] memory words = new bytes32[](4); words[3] = bytes32(uint256(1));
        router.configure(BUY_ROUTE, AtomicSpotRouter.Route(BUNDLE, MARKET, USDC, address(0), bytes4(keccak256("placeAndExecuteMarketBuy(uint96,uint256,bool,bool)")), 0, 1, 1e8, 1e6, 1, type(uint96).max, words));
        router.configure(SELL_ROUTE, AtomicSpotRouter.Route(BUNDLE, MARKET, address(0), USDC, bytes4(keccak256("placeAndExecuteMarketSell(uint96,uint256,bool,bool)")), 0, 1, 1e10, 1e18, 1, type(uint96).max, words));
        AtomicSpotModule.Market[] memory markets = new AtomicSpotModule.Market[](1);
        markets[0] = AtomicSpotModule.Market(MARKET_ID, BUY_ROUTE, SELL_ROUTE, address(quoter), 1 ether, address(oracle), FEED, 18, 6, BUY, SELL, 1e10, PROGRAM, 100_000);
        module.configure(BUNDLE, USDC, 9_500, 0, markets);
        registry.registerCall(BUNDLE, address(router), router.trade.selector, 100, 255, 1, 1 ether);
        registry.setCallValidator(BUNDLE, address(router), router.trade.selector, address(module));
        registry.registerRecoveryCall(BUNDLE, address(router), router.trade.selector, 100, 255);
        registry.setRecoveryCallValidator(BUNDLE, address(router), router.trade.selector, address(module));
        registry.registerNativeValue(BUNDLE, address(router), router.trade.selector, false, 1 ether, 255);
        registry.registerNativeValue(BUNDLE, address(router), router.trade.selector, true, 1 ether, 1);
        core.configureExecutionPolicy(BUNDLE, address(module), 1, 0, 60);
        core.setAppRecoveryAdapter(BUNDLE, address(module)); core.setExitPlanner(BUNDLE, address(module)); core.setExitVerifier(BUNDLE, address(module));
        core.configureExecutionAmountPrice(BUNDLE, BUY, MARKET_ID, _rule(18), PriceProtection.AmountRule(1, 6, 18, true, false, true, USDC, address(0)));
        core.configureExecutionAmountPrice(BUNDLE, SELL, MARKET_ID, _rule(6), PriceProtection.AmountRule(1, 18, 6, false, false, true, address(0), USDC));
        AppHealthReaderFactory factory = AppHealthReaderFactory(deployCode("AppHealthReaderFactory.sol:AppHealthReaderFactory",
            abi.encode(address(core), address(new SpotCollateralReader(core, MockERC20(USDC))))));
        health.setReader(BUNDLE, factory.create(BUNDLE, address(module), address(module)), 1, 60);
        registry.activate(BUNDLE);
    }

    function _rule(uint8 decimals) private view returns (PriceProtection.Rule memory) {
        return PriceProtection.Rule(address(oracle), FEED, address(router), router.trade.selector, 0, decimals, 2, 0, 100, 500, 60, 0, 1);
    }
    function _renew() internal {
        vm.roll(block.number + 1);
        for (uint256 i; i < guards.length; ++i) guards[i].renew(uint64(block.number - 1), blockhash(block.number - 1), uint64(block.timestamp));
    }
    function _prepare() internal {
        uint256 deadline = block.timestamp + 1 days; uint256 maturity = block.timestamp + 30 days;
        bytes32 digest = core.quoteDigest(keccak256("intent"), borrower, vm.addr(HOUSE_KEY), address(vault), DRAW, maturity, false, BUNDLE, deadline, 0, 0, 1, deadline, keccak256("terms"));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOUSE_KEY, digest);
        deal(USDC, borrower, COLLATERAL + 1_000);
        vm.startPrank(borrower);
        core.accept(CREDIT, keccak256("intent"), borrower, vm.addr(HOUSE_KEY), address(vault), DRAW, maturity, false, BUNDLE, deadline, 0, keccak256("terms"), 1, deadline, abi.encodePacked(r, s, v));
        MockERC20(USDC).approve(address(collateral), COLLATERAL); core.setCollateral(CREDIT, address(collateral), borrower);
        collateral.lock(LOCK, CREDIT, borrower, COLLATERAL, borrower); core.bindCollateral(CREDIT, LOCK);
        account = AccountFactory(deployCode("AccountFactory.sol:AccountFactory")).create(CREDIT, borrower, address(core)); core.bindAccount(CREDIT, account);
        vm.stopPrank(); core.configureRisk(CREDIT, 13_000, 12_000, 11_800, 11_500, 11_000); core.recordHealth(CREDIT);
    }
    function _action(bool buying, uint256 amount, uint256 bound) private view returns (ExecutionTypes.Action memory action) {
        action.capability = buying ? BUY : SELL; action.market = MARKET_ID;
        action.requiredInput = buying ? amount : 0; action.exposureLimit = action.requiredInput;
        action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(router), buying ? USDC : address(0), buying ? amount : 0,
            abi.encodeCall(router.trade, (buying ? BUY_ROUTE : SELL_ROUTE, amount, bound)), buying ? 0 : amount);
    }
    function _execute(bool buying, uint256 amount, uint256 nonce) internal {
        (uint256 price, uint256 at, uint80 round) = oracle.read(FEED);
        uint256 bound = core.priceProtection().deriveAmountBound(price, amount, 0, buying ? 6 : 18, buying ? 18 : 6, buying, false);
        ExecutionTypes.Action memory action = _action(buying, amount, bound);
        TermbookCore.ExecutionAuthorization memory auth = TermbookCore.ExecutionAuthorization(buying ? amount : 0, buying ? amount : 0, nonce,
            block.timestamp + 60, core.creditRevision(CREDIT), borrower, "", PriceProtection.Quote(round, price, at, block.timestamp, bound, 0, false));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BORROWER_KEY, core.executionDigest(CREDIT, action, auth));
        auth.signature = abi.encodePacked(r, s, v); core.executePlan(CREDIT, action, auth);
    }
    function _buy() internal {
        _execute(true, DRAW, 1);
        assertEq(core.creditDebt(CREDIT), DRAW); assertGt(account.balance, 0); assertEq(MockERC20(USDC).balanceOf(account), 0);
        assertEq(module.positionCount(CREDIT, account), 1); assertEq(MockERC20(USDC).allowance(account, address(router)), 0);
        (bytes32 position, bytes32 market) = module.positionAt(CREDIT, account, 0);
        assertEq(position, keccak256(abi.encode(MARKET_ID, address(0)))); assertEq(market, MARKET_ID);
        assertEq(address(router).balance, 0); assertEq(MockERC20(USDC).balanceOf(address(router)), 0);
        assertGt(core.previewHealth(CREDIT).appValue, 0);
    }
    function attemptBuy() external { _buy(); }

}

contract KuruForkTest is KuruForkFixture {
    function testForkBorrowBuySellRepayAndClose() public {
        _buy(); feed.update(int256(bid - 1e20 / account.balance - 1)); _execute(false, account.balance, 2);
        assertLe(account.balance, 1e10); assertTrue(module.canExit(CREDIT, account));
        vm.startPrank(borrower); core.repayAvailableCash(CREDIT);
        uint256 remaining = core.creditDebt(CREDIT); assertLt(remaining, 1_000);
        MockERC20(USDC).approve(address(core), remaining); core.repay(CREDIT, remaining);
        core.startClosing(CREDIT); core.authorizeReturn(CREDIT, LOCK, COLLATERAL); core.finishClose(CREDIT); vm.stopPrank();
        assertEq(core.creditDebt(CREDIT), 0); assertTrue(CreditAccount(payable(account)).released());
    }
    function testForkBorrowerClosureConvertsNativeHoldings() public {
        _buy(); feed.update(int256(bid - 1)); vm.prank(borrower); core.startClosing(CREDIT);
        (bytes32 step,, bool done,) = core.closeStep(CREDIT); assertFalse(done);
        vm.prank(borrower); core.advanceClose(CREDIT, step);
        assertGt(MockERC20(USDC).balanceOf(account), 0); assertTrue(module.canExit(CREDIT, account));
        vm.prank(borrower); vm.expectRevert(); core.advanceClose(CREDIT, step);
    }
    function testForkKeeperRecoversWithoutBorrower() public {
        _buy(); vm.warp(block.timestamp + 31 days); _renew(); feed.update(int256(bid - 1));
        address keeper = address(0xB0B); core.setRecoveryKeeper(keeper, true); core.markDefaulted(CREDIT); core.startLiquidation(CREDIT);
        (, bytes memory instruction,) = module.nextExitStep(CREDIT, account);
        vm.startPrank(keeper); core.recoverApp(CREDIT, instruction); core.recoverAccountCash(CREDIT, MockERC20(USDC).balanceOf(account));
        uint256 shortfall = core.creditDebt(CREDIT); assertLt(shortfall, COLLATERAL); core.recoverCollateral(CREDIT, shortfall); vm.stopPrank();
        assertEq(core.creditDebt(CREDIT), 0); assertTrue(module.canExit(CREDIT, account)); assertLe(account.balance, 1e10);
        vault.finalizeRecovery(CREDIT);
        vm.startPrank(borrower);
        core.authorizeReturn(CREDIT, LOCK, COLLATERAL - shortfall); core.releaseLiquidatedAccount(CREDIT);
        vm.stopPrank(); assertTrue(CreditAccount(payable(account)).released());
    }
    function testForkInsufficientSellDepthRejectsBorrowing() public {
        vm.mockCall(MARKET, abi.encodeCall(IKuruForkMarket.getL2Book, (16, 0)), abi.encode(abi.encodePacked(block.number, uint256(0))));
        vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDebt(CREDIT), 0); assertEq(account.balance, 0);
    }
    function testForkExpiredMonitorRejectsBorrowing() public {
        vm.warp(block.timestamp + 181); feed.update(int256(ask + 1));
        vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDebt(CREDIT), 0);
    }
    function testForkChangedImplementationRevokesDependency() public {
        vm.etch(guards[0].implementation(), hex"60006000fd");
        assertFalse(registry.dependenciesValid(BUNDLE)); vm.expectRevert(); this.attemptBuy(); assertEq(core.creditDebt(CREDIT), 0);
    }
}
