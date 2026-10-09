// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AtomicSpotTest, SpotCollateralReader} from "./atomic-spot.t.sol";
import {UseCaseReader} from "../../src/monad/integration/UseCaseReader.sol";
import {UseCasePolicy} from "../../src/monad/integration/UseCasePolicy.sol";
import {UseCaseRecovery} from "../../src/monad/integration/UseCaseRecovery.sol";
import {AppHealthReaderFactory} from "../../src/monad/risk/AppHealthReaderFactory.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";

contract UseCaseSpotFlowTest is AtomicSpotTest {
    UseCaseReader standardReader;
    UseCasePolicy standardPolicy;
    UseCaseRecovery standardRecovery;
    function _configureHooks() internal override {
        standardReader = new UseCaseReader(address(this), address(core), address(registry), address(quoter));
        standardPolicy = new UseCasePolicy(address(this), address(core), address(standardReader));
        standardRecovery = new UseCaseRecovery(address(this), address(core), address(standardReader));
        registry.pinDependency(bundle, address(standardReader)); registry.pinDependency(bundle, address(standardPolicy)); registry.pinDependency(bundle, address(standardRecovery));
        UseCaseReader.Config memory config;
        config.useCase = UseCaseReader.UseCase.Spot; config.settlement = address(usdc); config.retainedBps = 9_000; config.maxPositions = 1;
        config.assets = new UseCaseReader.Asset[](1);
        config.assets[0] = UseCaseReader.Asset(address(base), address(oracle), feedId, 18, 1000 ether, 1e12, quoteProgram, address(market));
        config.markets = new UseCaseReader.Market[](1);
        config.markets[0] = UseCaseReader.Market(marketId, address(market), config.assets[0], config.assets[0], 1000e6);
        standardReader.configure(bundle, config);
        UseCasePolicy.Call[] memory calls = new UseCasePolicy.Call[](1);
        UseCasePolicy.Word[] memory words = new UseCasePolicy.Word[](3);
        words[0] = UseCasePolicy.Word(UseCasePolicy.Kind.Range, bytes32(0), 0, type(uint256).max);
        words[1] = UseCasePolicy.Word(UseCasePolicy.Kind.Spend, bytes32(0), 1, 1000 ether);
        words[2] = UseCasePolicy.Word(UseCasePolicy.Kind.Range, bytes32(0), 1, type(uint256).max);
        calls[0] = UseCasePolicy.Call(address(router), router.trade.selector, true, words);
        UseCasePolicy.Action[] memory actions = new UseCasePolicy.Action[](2);
        for (uint256 i; i < 2; ++i) {
            UseCasePolicy.Call[] memory specific = new UseCasePolicy.Call[](1);
            UseCasePolicy.Word[] memory constraints = new UseCasePolicy.Word[](3);
            constraints[0] = UseCasePolicy.Word(UseCasePolicy.Kind.Exact, i == 0 ? buyRoute : sellRoute, 0, 0);
            constraints[1] = words[1]; constraints[2] = words[2];
            specific[0] = UseCasePolicy.Call(address(router), router.trade.selector, false, constraints);
            actions[i] = UseCasePolicy.Action(i == 0 ? buy : sell, marketId, keccak256("place_order"), i == 0 ? uint128(200e6) : 0, 200e6, false, specific);
        }
        standardPolicy.configure(bundle, actions, calls);
        UseCaseRecovery.Template[] memory exits = new UseCaseRecovery.Template[](1);
        UseCaseRecovery.Word[] memory args = new UseCaseRecovery.Word[](3);
        args[0] = UseCaseRecovery.Word(UseCaseRecovery.Source.Literal, sellRoute);
        args[1] = UseCaseRecovery.Word(UseCaseRecovery.Source.Field, bytes32(uint256(1)));
        args[2] = UseCaseRecovery.Word(UseCaseRecovery.Source.Minimum, bytes32(0));
        exits[0] = UseCaseRecovery.Template(UseCaseRecovery.Phase.Holding, bytes32(uint256(uint160(address(base)))), address(router), router.trade.selector,
            args, address(base), address(usdc), 1, 2, false);
        standardRecovery.configure(bundle, exits);
        core.configureExecutionPolicy(bundle, address(standardPolicy), 1, 0, 60);
        core.setAppRecoveryAdapter(bundle, address(standardRecovery)); core.setExitPlanner(bundle, address(standardRecovery)); core.setExitVerifier(bundle, address(standardRecovery));
        core.configureExecutionAmountPrice(bundle, buy, marketId, _rule(18), PriceProtection.AmountRule(1, 6, 18, true, false, true, address(usdc), address(base)));
        core.configureExecutionAmountPrice(bundle, sell, marketId, _rule(6), PriceProtection.AmountRule(1, 18, 6, false, false, true, address(base), address(usdc)));
        AppHealthReaderFactory factory = new AppHealthReaderFactory(address(core), address(new SpotCollateralReader(core, usdc)));
        address reader = factory.create(bundle, address(standardReader), address(standardRecovery));
        health.setReader(bundle, reader, 1, 60); registry.activate(bundle);
    }
    function testAnotherActionCannotBorrowBuyPermissions() public {
        _buy();
        ExecutionTypes.Action memory action = _action(false, 1 ether, 2e6);
        action.calls[0].data = abi.encodeCall(router.trade, (buyRoute, 1 ether, 1));
        vm.expectRevert(); this.attemptWrongAction(action);
    }
    function attemptWrongAction(ExecutionTypes.Action calldata action) external { _execute(action, 0, 2); }
}
