// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OracleRegistry} from "../../src/monad/risk/OracleRegistry.sol";
import {PriceFeedFixture, PriceFeedGuardFixture} from "./price-protection.t.sol";
import {CoreFixture} from "../CoreFixture.sol";
import {ExecutionPolicyFixture} from "./execution-manager.t.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";
import {ExecutionManager} from "../../src/monad/integration/ExecutionManager.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {IHealthSource} from "../../src/monad/risk/IHealthSource.sol";
import {HealthMath} from "../../src/monad/risk/HealthMath.sol";
import {Types} from "../../src/shared/Types.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockAppCallValidator} from "../MockAppCallValidator.sol";
import {MockExitVerifier, FundedPositionRecoveryAdapter, FundedPositionTarget} from "./real-flow.t.sol";

contract ExecutionHealthFixture is IHealthSource {
    TermbookCore public immutable core;
    MockERC20 public immutable token;
    ExecutionPolicyFixture public immutable app;
    uint256 public sourceValue = 100;
    bool public unavailable;
    constructor(TermbookCore core_, MockERC20 token_, ExecutionPolicyFixture app_) { core = core_; token = token_; app = app_; }
    function setSourceValue(uint256 value) external { sourceValue = value; }
    function setUnavailable(bool value) external { unavailable = value; }
    function isReaderActive(bytes32) external pure returns (bool) { return true; }
    function freeCash(bytes32 id, bytes32, uint256) external view returns (uint256) { return token.balanceOf(core.creditAccount(id)); }
    function snapshot(bytes32 id, bytes32, uint256, uint256 debt) external view returns (Types.HealthSnapshot memory) {
        require(!unavailable);
        uint256 cash = token.balanceOf(core.creditAccount(id));
        uint256 value = token.balanceOf(address(app));
        uint256 recovery = cash + sourceValue + value;
        return Types.HealthSnapshot(debt, cash, sourceValue, int256(value), 10_000, 10_000, 0, recovery,
            HealthMath.healthBps(recovery, debt, 0));
    }
}

contract ExecutionCoreTest is CoreFixture {
    TermbookCore core;
    ExecutionManager manager;
    ExecutionPolicyFixture policy;
    ExecutionHealthFixture health;
    MockERC20 token;
    MockERC20 spotOutput;
    OracleRegistry spotOracle;
    PriceFeedFixture spotFeed;
    bytes32 spotFeedId = keccak256("spot ratio");
    HouseVault vault;
    CreditAccount account;
    RiskEngine risk;
    bytes32 credit = keccak256("credit");
    bytes32 bundle = keccak256("bundle");
    uint256 borrowerKey = 0xCAFE;
    uint256 houseKey = 0xBEEF;
    uint256 sessionKey = 0xCECE;
    address borrower;

    function setUp() public {
        vm.warp(1_000);
        borrower = vm.addr(borrowerKey);
        token = new MockERC20();
        core = _deployCore(address(this), address(this), address(0));
        manager = core.executionManager();
        risk = new RiskEngine(address(core));
        core.setRisk(address(risk));
        account = new CreditAccount(credit, borrower, address(core));
        policy = new ExecutionPolicyFixture(address(account));
        policy.setToken(token);
        health = new ExecutionHealthFixture(core, token, policy);
        core.setHealthSource(address(health));
        core.setExitVerifier(bundle, address(new MockExitVerifier()));
        core.setAppRecoveryAdapter(bundle, address(new FundedPositionRecoveryAdapter(new FundedPositionTarget(token))));
        core.configureExecutionPolicy(bundle, address(policy), 2, 2, 300);
        IntegrationRegistry registry = new IntegrationRegistry(address(this));
        registry.approve(bundle, keccak256("manifest"));
        registry.registerCall(bundle, address(policy), policy.noop.selector, 4, type(uint8).max, type(uint8).max, 0);
        registry.registerCall(bundle, address(policy), policy.submit.selector, 4, type(uint8).max, type(uint8).max, 100);
        registry.registerRecoveryCall(bundle, address(policy), policy.noop.selector, 4, type(uint8).max);
        MockAppCallValidator validator = new MockAppCallValidator();
        registry.setCallValidator(bundle, address(policy), policy.noop.selector, address(validator));
        registry.setCallValidator(bundle, address(policy), policy.submit.selector, address(validator));
        registry.setRecoveryCallValidator(bundle, address(policy), policy.noop.selector, address(validator));
        registry.registerNativeValue(bundle, address(policy), policy.noop.selector, false, 1 ether, type(uint8).max);
        registry.registerCall(bundle, address(policy), policy.consumeOwned.selector, 68, type(uint8).max, 1, 100);
        registry.setCallValidator(bundle, address(policy), policy.consumeOwned.selector, address(validator));
        spotOutput = new MockERC20();
        registry.pinDependency(bundle, address(token));
        registry.pinDependency(bundle, address(spotOutput));
        registry.registerCall(bundle, address(policy), policy.swapOwned.selector, 132, type(uint8).max, 1, 100);
        registry.setCallValidator(bundle, address(policy), policy.swapOwned.selector, address(validator));
        registry.activate(bundle);
        core.setIntegrationRegistry(address(registry));
        spotOracle = new OracleRegistry(address(this));
        spotFeed = new PriceFeedFixture(); spotFeed.update(1e8);
        spotOracle.setFeed(spotFeedId, address(spotFeed), 300, 8);
        spotOracle.setFeedGuard(spotFeedId, address(new PriceFeedGuardFixture(spotFeed)));
        PriceProtection.Rule memory spotRule = PriceProtection.Rule(address(spotOracle), spotFeedId, address(policy),
            policy.swapOwned.selector, 0, 18, 2, 0, 100, 500, 60, 0, 0);
        core.configureExecutionAmountPrice(bundle, keccak256("place_order"), keccak256("spot"), spotRule,
            PriceProtection.AmountRule(1, 18, 18, false, false, true, address(token), address(spotOutput)));
        InboxFactory factory = InboxFactory(deployCode("InboxFactory.sol:InboxFactory", abi.encode(address(this))));
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(token), address(core), address(this), address(factory), address(0))));
        token.mint(address(this), 1000);
        token.approve(address(vault), 1000);
        vault.deposit(address(this), 1000);
        bytes32 intent = keccak256("intent");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        bytes32 terms = keccak256("terms");
        bytes32 digest = core.quoteDigest(intent, borrower, vm.addr(houseKey), address(vault), 500,
            maturity, true, bundle, setupDeadline, 0, 0, 1, setupDeadline, terms);
        vm.prank(borrower);
        core.accept(credit, intent, borrower, vm.addr(houseKey), address(vault), 500, maturity, true,
            bundle, setupDeadline, 0, terms, 1, setupDeadline, _sign(houseKey, digest));
        CollateralVault collateral = new CollateralVault(address(token), block.chainid, address(core));
        core.setLocalCollateralVault(address(collateral), address(collateral).codehash);
        token.mint(borrower, 100);
        vm.startPrank(borrower);
        token.approve(address(collateral), 100);
        core.setCollateral(credit, address(collateral), borrower);
        bytes32 lock = keccak256("lock");
        collateral.lock(lock, credit, borrower, 100, borrower);
        core.bindCollateral(credit, lock);
        core.bindAccount(credit, address(account));
        vm.stopPrank();
        core.configureRisk(credit, 15_000, 13_000, 12_000, 11_500, 11_000);
    }

    function _sign(uint256 key, bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
    function _action() internal view returns (ExecutionTypes.Action memory action) {
        action.capability = keccak256("place_order");
        action.market = keccak256("ETH");
        action.requiredInput = 100;
        action.exposureLimit = 100;
        action.calls = new ExecutionTypes.Call[](2);
        action.calls[0] = ExecutionTypes.Call(address(policy), address(0), 0, abi.encodeCall(policy.noop, ()), 0);
        action.calls[1] = ExecutionTypes.Call(address(policy), address(token), 100, abi.encodeCall(policy.submit, ()), 0);
    }
    function _authorization(ExecutionTypes.Action memory action, uint256 key, uint256 nonce)
        internal view returns (TermbookCore.ExecutionAuthorization memory auth) {
        auth = TermbookCore.ExecutionAuthorization(100, 100, nonce, block.timestamp + 300,
            core.creditRevision(credit), vm.addr(key), "", PriceProtection.Quote(0, 0, 0, 0, 0, 0, false));
        auth.signature = _sign(key, core.executionDigest(credit, action, auth));
    }
    function _execute() internal {
        ExecutionTypes.Action memory action = _action();
        core.executePlan(credit, action, _authorization(action, borrowerKey, 1));
    }

    function testSpotUnderDeliveryRevertsDrawApprovalsNonceAndSwap() public {
        policy.setSynchronousRequired(100);
        ExecutionTypes.Action memory action = _action();
        action.market = keccak256("spot");
        action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(policy), address(token), 100,
            abi.encodeCall(policy.swapOwned, (spotOutput, 100, 100, 99)), 0);
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        (uint256 price, uint256 updated, uint80 round) = spotOracle.read(spotFeedId);
        auth.price = PriceProtection.Quote(round, price, updated, block.timestamp, 100, 0, false);
        auth.signature = _sign(borrowerKey, core.executionDigest(credit, action, auth));
        vm.expectRevert(PriceProtection.Invalid.selector);
        core.executePlan(credit, action, auth);
        assertEq(core.creditDebt(credit), 0); assertEq(token.balanceOf(address(vault)), 1000);
        assertEq(spotOutput.balanceOf(address(account)), 0); assertEq(token.allowance(address(account), address(policy)), 0);
        assertFalse(core.nonceUsed(credit, 1));
        action.calls[0].data = abi.encodeCall(policy.swapOwned, (spotOutput, 100, 100, 100));
        auth.signature = _sign(borrowerKey, core.executionDigest(credit, action, auth));
        core.executePlan(credit, action, auth);
        assertEq(core.creditDebt(credit), 100); assertEq(spotOutput.balanceOf(address(account)), 100);
        assertEq(token.allowance(address(account), address(policy)), 0);
    }
    function testNativeValueIsSignedBoundedAndSpentFromAccount() public {
        vm.deal(address(account), 2 ether);
        ExecutionTypes.Action memory action = _action();
        action.calls[0].nativeValue = 1 ether;
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        action.calls[0].nativeValue -= 1;
        vm.expectRevert(TermbookCore.BadSig.selector);
        core.executePlan(credit, action, auth);
        action.calls[0].nativeValue = 1 ether;
        core.executePlan(credit, action, auth);
        assertEq(address(policy).balance, 1 ether);
        assertEq(address(account).balance, 1 ether);
        assertEq(core.creditDebt(credit), 100);
    }
    function testUnapprovedNativeValueRollsBackLoanAndEarlierCalls() public {
        vm.deal(address(account), 3 ether);
        ExecutionTypes.Action memory action = _action();
        action.calls[0].nativeValue = 2 ether;
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        vm.expectRevert(TermbookCore.Unauthorized.selector);
        core.executePlan(credit, action, auth);
        assertEq(core.creditDebt(credit), 0);
        assertEq(address(account).balance, 3 ether);
        assertEq(policy.callsExecuted(), 0);
    }
    function testOwnedSettlementCashCanBeSpentWithZeroDraw() public {
        token.mint(address(account), 100);
        ExecutionTypes.Action memory action = _action();
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        auth.drawAmount = 0; auth.maxDraw = 0;
        auth.signature = _sign(borrowerKey, core.executionDigest(credit, action, auth));
        core.executePlan(credit, action, auth);
        assertEq(core.creditDebt(credit), 0); assertEq(token.balanceOf(address(vault)), 1000);
        assertEq(token.balanceOf(address(policy)), 100); assertEq(token.allowance(address(account), address(policy)), 0);
    }
    function testOwnedTokenSpendDoesNotBorrowSettlementAsset() public {
        MockERC20 owned = new MockERC20();
        owned.mint(address(account), 100);
        policy.setSynchronous();
        ExecutionTypes.Action memory action = _action();
        action.requiredInput = 0;
        action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(policy), address(owned), 100, abi.encodeCall(policy.consumeOwned, (owned, 100)), 0);
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        auth.drawAmount = 0; auth.maxDraw = 0;
        auth.signature = _sign(borrowerKey, core.executionDigest(credit, action, auth));
        core.executePlan(credit, action, auth);
        assertEq(core.creditDebt(credit), 0);
        assertEq(owned.balanceOf(address(account)), 0);
        assertEq(owned.balanceOf(address(policy)), 100);
        assertEq(owned.allowance(address(account), address(policy)), 0);
        assertEq(token.balanceOf(address(vault)), 1000);
    }
    function testSettlementSpendingCannotBeHiddenFromRequiredFunding() public {
        ExecutionTypes.Action memory action = _action();
        action.requiredInput = 0;
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        auth.drawAmount = 0;
        auth.signature = _sign(borrowerKey, core.executionDigest(credit, action, auth));
        vm.expectRevert(TermbookCore.InvalidTerms.selector);
        core.executePlan(credit, action, auth);
    }
    function testExecutionSignatureBindsThePriceAuthorization() public {
        ExecutionTypes.Action memory action = _action();
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        auth.price.bound = 1;
        vm.expectRevert(TermbookCore.BadSig.selector);
        core.executePlan(credit, action, auth);
    }

    function testMultiCallExecutesAsAccountAndRecordsPendingCustody() public {
        _execute();
        assertEq(policy.callsExecuted(), 1);
        assertEq(token.balanceOf(address(policy)), 100);
        assertEq(core.creditDebt(credit), 100);
        assertEq(manager.pendingCount(credit), 1);
        assertEq(token.allowance(address(account), address(policy)), 0);
        ExecutionTypes.Action memory action = _action();
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        vm.expectRevert(TermbookCore.Used.selector);
        core.executePlan(credit, action, auth);
    }

    function testLaterCallFailureRevertsTheDrawEarlierCallAndNonce() public {
        policy.setRejected(true);
        ExecutionTypes.Action memory action = _action();
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, borrowerKey, 1);
        vm.expectRevert();
        core.executePlan(credit, action, auth);
        assertEq(core.creditDebt(credit), 0);
        assertEq(policy.callsExecuted(), 0);
        assertEq(token.balanceOf(address(policy)), 0);
        assertEq(vault.creditCommitted(credit), 500);
        assertFalse(core.nonceUsed(credit, 1));
    }

    function testExternalFillPersistsWhenOracleIsUnavailableAndCannotRepeatRisk() public {
        _execute();
        policy.fill(40, 0, true);
        health.setUnavailable(true);
        core.syncActions(credit);
        (,,,, ExecutionTypes.PendingState memory state) = manager.records(credit, policy.id());
        assertEq(state.filled, 40);
        assertEq(state.remaining, 60);
        assertTrue(core.actionHealthBlocked(credit));
        assertEq(core.creditDebt(credit), 100);
        health.setUnavailable(false);
        health.setSourceValue(0);
        core.syncActions(credit);
        assertTrue(core.actionHealthBlocked(credit));
        assertEq(uint256(risk.riskState(credit)), uint256(Types.Risk.Liquidatable));
    }

    function testScopedSessionExecutesWithoutConsumingPrimaryNonceAndRevokesOnChain() public {
        ExecutionManager.Permission[] memory permissions = new ExecutionManager.Permission[](1);
        permissions[0] = ExecutionManager.Permission(keccak256("place_order"), keccak256("ETH"));
        vm.prank(borrower);
        core.configureExecutionSession(credit, vm.addr(sessionKey), permissions, 100, 100, 100, 100, block.timestamp + 300);
        ExecutionTypes.Action memory action = _action();
        core.executePlan(credit, action, _authorization(action, sessionKey, 1));
        assertEq(core.creditDetails(credit).nonce, 0);
        vm.prank(borrower);
        core.revokeExecutionSession(credit, vm.addr(sessionKey));
        TermbookCore.ExecutionAuthorization memory auth = _authorization(action, sessionKey, 3);
        vm.expectRevert(ExecutionManager.Unauthorized.selector);
        core.executePlan(credit, action, auth);
    }
}
