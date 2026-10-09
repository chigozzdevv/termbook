// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {IntegrationRegistry} from "../../src/monad/integration/IntegrationRegistry.sol";
import {ReadProgram} from "../../src/monad/integration/ReadProgram.sol";
import {ExecutionTypes} from "../../src/monad/integration/IExecutionPolicy.sol";
import {UseCaseReader} from "../../src/monad/integration/UseCaseReader.sol";
import {UseCasePolicy} from "../../src/monad/integration/UseCasePolicy.sol";
import {UseCaseRecovery} from "../../src/monad/integration/UseCaseRecovery.sol";
import {OracleRegistry} from "../../src/monad/risk/OracleRegistry.sol";
import {PriceFeedFixture, PriceFeedGuardFixture} from "./price-protection.t.sol";

contract StandardDollar is MockERC20 { constructor() { decimals = 6; } }
contract StandardCreditFixture {
    TermbookCore.Credit private credit;
    function setCredit(address account, bytes32 bundle, uint256 maturity) external { credit.account = account; credit.bundleId = bundle; credit.maturity = maturity; }
    function creditDetails(bytes32) external view returns (TermbookCore.Credit memory) { return credit; }
}
contract StandardVenueFixture {
    uint256[5] private metadata;
    uint256[16] private holding;
    uint256[14] private pending;
    uint256[9] private withdrawal;
    function setMeta(uint256[5] calldata value) external { metadata = value; }
    function setPosition(uint256[16] calldata value) external { holding = value; }
    function setPending(uint256[14] calldata value) external { pending = value; }
    function setRequest(uint256[9] calldata value) external { withdrawal = value; }
    function meta() external view returns (uint256[5] memory) { return metadata; }
    function position(uint256) external view returns (uint256[16] memory) { return holding; }
    function order(uint256) external view returns (uint256[14] memory) { return pending; }
    function request(uint256) external view returns (uint256[9] memory) { return withdrawal; }
    function bomb() external pure { assembly { return(0, 16384) } }
    function close(address token, uint256 amount, address recipient) external {
        holding[3] = 0; holding[12] = 0; metadata[1] = 0;
        require(MockERC20(token).transfer(recipient, amount));
    }
    function steal(address token, uint256 amount, address recipient) external {
        holding[3] = 0; metadata[1] = 0;
        require(MockERC20(token).transfer(recipient, amount / 2));
    }
}

contract UseCaseTest is CoreFixture {
    ReadProgram programs;
    UseCaseReader reader;
    UseCasePolicy policy;
    UseCaseRecovery recovery;
    StandardCreditFixture core;
    StandardVenueFixture venue;
    IntegrationRegistry registry;
    MockERC20 base;
    StandardDollar dollar;
    OracleRegistry oracle;
    PriceFeedFixture price;
    PriceFeedFixture dollarPrice;
    bytes32 constant bundle = keccak256("standard");
    bytes32 constant creditId = keccak256("credit");
    bytes32 constant market = keccak256("market");
    bytes32 constant feed = keccak256("base");
    bytes32 constant dollarFeed = keccak256("dollar");
    address constant account = address(0xB0B);
    bytes32 metaProgram;
    bytes32 positionProgram;
    bytes32 pendingProgram;
    bytes32 requestProgram;
    UseCaseReader.Config config;

    function setUp() public {
        vm.warp(10_000);
        core = new StandardCreditFixture(); venue = new StandardVenueFixture(); registry = new IntegrationRegistry(address(this));
        programs = new ReadProgram(address(this)); base = new MockERC20(); dollar = new StandardDollar(); oracle = new OracleRegistry(address(this));
        price = new PriceFeedFixture(); price.update(2e8); dollarPrice = new PriceFeedFixture(); dollarPrice.update(1e8);
        oracle.setFeed(feed, address(price), 1 days, 8); oracle.setFeed(dollarFeed, address(dollarPrice), 1 days, 8);
        oracle.setFeedGuard(feed, address(new PriceFeedGuardFixture(price))); oracle.setFeedGuard(dollarFeed, address(new PriceFeedGuardFixture(dollarPrice)));
        core.setCredit(account, bundle, block.timestamp + 1 days);
        reader = new UseCaseReader(address(this), address(core), address(registry), address(programs));
        policy = new UseCasePolicy(address(this), address(core), address(reader)); recovery = new UseCaseRecovery(address(this), address(core), address(reader));
        registry.approve(bundle, keccak256("definition"));
        address[8] memory targets = [address(venue), address(programs), address(base), address(dollar), address(oracle), address(reader), address(policy), address(recovery)];
        for (uint256 i; i < targets.length; ++i) registry.pinDependency(bundle, targets[i]);
        metaProgram = _program(abi.encodeCall(venue.meta, ()), 5, false);
        positionProgram = _program(abi.encodeCall(venue.position, (0)), 16, true);
        pendingProgram = _program(abi.encodeCall(venue.order, (0)), 14, true);
        requestProgram = _program(abi.encodeCall(venue.request, (0)), 9, true);
        config.settlement = address(dollar); config.stateTarget = address(venue); config.metaProgram = metaProgram;
        config.positionProgram = positionProgram; config.pendingProgram = pendingProgram; config.reconcileProgram = pendingProgram;
        config.requestProgram = requestProgram; config.retainedBps = 9_000; config.maxPositions = 4; config.maxPending = 4; config.maxRequests = 4;
        config.markets.push(); config.markets[0].id = market; config.markets[0].receipt = address(venue);
        config.markets[0].asset0 = _asset(address(base), feed, 18); config.markets[0].asset1 = _asset(address(dollar), dollarFeed, 6);
        config.markets[0].maximumExposure = 1_000e6;
        venue.setMeta([uint256(uint160(account)), 1, 0, 0, 0]);
        uint256[16] memory state; state[0] = uint256(uint160(account)); state[1] = 1; state[2] = uint256(market);
        state[3] = 10 ether; state[7] = 100e6; state[8] = 500e6; state[11] = 1000e6; state[12] = 10; state[13] = 10 ether; state[14] = 10;
        venue.setPosition(state);
    }
    function _asset(address token, bytes32 id, uint8 decimals) internal view returns (UseCaseReader.Asset memory) {
        return UseCaseReader.Asset(token, address(oracle), id, decimals, uint128(1_000_000 ether), 0, bytes32(0), address(0));
    }
    function _program(bytes memory data, uint256 outputs, bool withIndex) internal returns (bytes32 id) {
        ReadProgram.Program memory p;
        p.queries = new ReadProgram.Query[](1);
        ReadProgram.Argument[] memory args = new ReadProgram.Argument[](withIndex ? 1 : 0);
        if (withIndex) args[0] = ReadProgram.Argument(0, 0);
        p.queries[0] = ReadProgram.Query(address(venue), data, args, bytes32(0), 100_000);
        p.steps = new ReadProgram.Step[](1 + outputs * 2); p.outputs = new uint16[](outputs);
        p.steps[0].op = ReadProgram.Op.Index;
        for (uint256 i; i < outputs; ++i) {
            p.steps[1 + 2 * i] = ReadProgram.Step(ReadProgram.Op.Constant, 0, 0, 0, i);
            p.steps[2 + 2 * i] = ReadProgram.Step(ReadProgram.Op.Word, uint16(1 + 2 * i), 0, 0, 0);
            p.outputs[i] = uint16(2 + 2 * i);
        }
        id = keccak256(abi.encode(p)); programs.configure(id, p);
    }
    function _configure(UseCaseReader.UseCase profile) internal {
        if (profile == UseCaseReader.UseCase.Perps) { uint256[16] memory state = venue.position(0); state[3] = 50 ether; venue.setPosition(state); }
        config.useCase = profile; reader.configure(bundle, config); }
    function _value() internal view returns (int256 value) { (value,,,) = reader.readAppValue(creditId, account, address(dollar)); }

    function testSpotValueIsCappedByIndependentOracle() public { _configure(UseCaseReader.UseCase.Spot); assertEq(_value(), 20e6); }
    function testVaultAndStakingCannotCountReportedValueWithoutUnderlying() public {
        _configure(UseCaseReader.UseCase.Vault); assertEq(_value(), 20e6);
        uint256[16] memory state = venue.position(0); state[3] = 0; venue.setPosition(state); assertEq(_value(), 0);
    }
    function testStakingRewardsAreIncludedOnce() public {
        uint256[16] memory state = venue.position(0); state[5] = 2 ether; venue.setPosition(state);
        _configure(UseCaseReader.UseCase.Staking); assertEq(_value(), 24e6);
    }
    function testLiquidityValuesBothUnderlyingTokens() public {
        uint256[16] memory state = venue.position(0); state[4] = 10e6; state[5] = 1 ether; state[6] = 2e6; venue.setPosition(state);
        _configure(UseCaseReader.UseCase.Liquidity); assertEq(_value(), 34e6);
    }
    function testPerpsNegativePnlAndLiabilitiesRemainNegative() public {
        uint256[16] memory state = venue.position(0); state[9] = uint256(int256(-150e6)); state[10] = 10e6; venue.setPosition(state);
        _configure(UseCaseReader.UseCase.Perps); assertEq(_value(), -60e6);
    }
    function testPerpsMarginCannotExceedIndependentlyValuedBacking() public {
        _configure(UseCaseReader.UseCase.Perps);
        uint256[16] memory state = venue.position(0); state[3] = 1 ether; venue.setPosition(state);
        assertEq(_value(), 2e6);
    }
    function testForeignOwnerAndExposureOverflowFailClosed() public {
        _configure(UseCaseReader.UseCase.Perps);
        uint256[16] memory state = venue.position(0); state[0] = uint256(uint160(address(0xBAD))); venue.setPosition(state);
        vm.expectRevert(); reader.readAppValue(creditId, account, address(dollar));
        state[0] = uint256(uint160(account)); state[8] = 1_001e6; venue.setPosition(state);
        vm.expectRevert(); reader.position(creditId, account, 0);
    }
    function testReservedCashAndPendingLiabilityCannotBeSpentOrHidden() public {
        dollar.mint(account, 20e6); venue.setMeta([uint256(uint160(account)), 1, 1, 0, 5e6]);
        uint256[14] memory order; order[0] = uint256(uint160(account)); order[1] = 99; order[3] = 10e6; order[6] = 10e6;
        order[8] = 3e6; order[9] = 5e6; order[10] = block.timestamp + 60; order[12] = uint256(uint160(account)); order[13] = 1; venue.setPending(order);
        _configure(UseCaseReader.UseCase.Spot); assertEq(_value(), 15e6);
        (uint256 reserved,) = reader.reservedCash(creditId, account, address(dollar)); assertEq(reserved, 5e6);
        order[4] = 1; venue.setPending(order); vm.expectRevert(); reader.order(creditId, account, 0);
    }
    function testUnbondingAfterMaturityHasNoBorrowingValue() public {
        venue.setMeta([uint256(uint160(account)), 0, 0, 1, 0]);
        uint256[9] memory request; request[0] = uint256(uint160(account)); request[1] = 7; request[2] = uint256(market);
        request[3] = 10 ether; request[6] = 1000e6; request[7] = block.timestamp + 2 days; venue.setRequest(request);
        _configure(UseCaseReader.UseCase.Staking); assertEq(_value(), 0);
        request[7] = block.timestamp + 1 hours; venue.setRequest(request); assertEq(_value(), 20e6);
    }
    function testPositionAndItsWithdrawalCannotBeCountedTwice() public {
        venue.setMeta([uint256(uint160(account)), 1, 0, 1, 0]);
        uint256[9] memory request; request[0] = uint256(uint160(account)); request[1] = 7; request[2] = uint256(market);
        request[3] = 10 ether; request[6] = 20e6; request[7] = block.timestamp; request[8] = 1; venue.setRequest(request);
        _configure(UseCaseReader.UseCase.Vault); vm.expectRevert(); reader.readAppValue(creditId, account, address(dollar));
    }
    function testPartialUnstakeCountsOnlyRemainingStakeAndSeparateClaim() public {
        venue.setMeta([uint256(uint160(account)), 1, 0, 1, 0]);
        uint256[16] memory state = venue.position(0); state[3] = 6 ether; state[13] = 6 ether; venue.setPosition(state);
        uint256[9] memory request; request[0] = uint256(uint160(account)); request[1] = 7; request[2] = uint256(market);
        request[3] = 4 ether; request[6] = 8e6; request[7] = block.timestamp + 1 hours; venue.setRequest(request);
        _configure(UseCaseReader.UseCase.Staking); assertEq(_value(), 20e6);
    }
    function testStaleOracleAndChangedDependencyBlockHealth() public {
        _configure(UseCaseReader.UseCase.Vault); vm.warp(block.timestamp + 2 days);
        vm.expectRevert(); reader.readAppValue(creditId, account, address(dollar));
        vm.warp(10_000); vm.etch(address(venue), hex"00"); vm.expectRevert(); reader.positionCount(creditId, account);
    }
    function _recovery(bytes4 selector) internal {
        UseCaseRecovery.Template[] memory rules = new UseCaseRecovery.Template[](1);
        UseCaseRecovery.Word[] memory words = new UseCaseRecovery.Word[](3);
        words[0] = UseCaseRecovery.Word(UseCaseRecovery.Source.Literal, bytes32(uint256(uint160(address(dollar)))));
        words[1] = UseCaseRecovery.Word(UseCaseRecovery.Source.Minimum, bytes32(0));
        words[2] = UseCaseRecovery.Word(UseCaseRecovery.Source.Account, bytes32(0));
        rules[0] = UseCaseRecovery.Template(UseCaseRecovery.Phase.Position, market, address(venue), selector, words, address(0), address(dollar), 255, 10, false);
        recovery.configure(bundle, rules);
    }
    function testRecoveryUsesCappedValueAndReturnsFundsToAccount() public {
        _configure(UseCaseReader.UseCase.Vault); _recovery(venue.close.selector); dollar.mint(address(venue), 20e6);
        (, bytes memory instruction,) = recovery.nextExitStep(creditId, account);
        (address target, bytes memory data,, bytes32 expected) = recovery.recoveryCall(creditId, account, instruction);
        (bool ok,) = target.call(data); assertTrue(ok); assertEq(dollar.balanceOf(account), 18e6);
        assertTrue(recovery.verifyRecovery(creditId, account, instruction, expected)); assertTrue(recovery.canExit(creditId, account));
        vm.expectRevert(); recovery.recoveryCall(creditId, account, instruction);
    }
    function testRecoveryRejectsLostFundsDespiteVenueSayingPositionClosed() public {
        _configure(UseCaseReader.UseCase.Vault); _recovery(venue.steal.selector); dollar.mint(address(venue), 20e6);
        (, bytes memory instruction,) = recovery.nextExitStep(creditId, account);
        (address target, bytes memory data,, bytes32 expected) = recovery.recoveryCall(creditId, account, instruction);
        (bool ok,) = target.call(data); assertTrue(ok);
        assertFalse(recovery.verifyRecovery(creditId, account, instruction, expected));
    }
    function testReadProgramRejectsOversizedReturnAndForwardReferences() public {
        bytes32 bomb = _program(abi.encodeCall(venue.bomb, ()), 1, false);
        vm.expectRevert(); programs.read(bomb, ReadProgram.Context(address(venue), account, creditId, 0, 0));
        ReadProgram.Program memory p; p.queries = new ReadProgram.Query[](0); p.steps = new ReadProgram.Step[](1); p.outputs = new uint16[](1);
        p.steps[0].op = ReadProgram.Op.Add; vm.expectRevert(); programs.configure(keccak256("forward"), p);
    }
    function _policyAction() internal returns (ExecutionTypes.Action memory action) {
        _configure(UseCaseReader.UseCase.Perps);
        UseCasePolicy.Word[] memory words = new UseCasePolicy.Word[](3);
        words[0] = UseCasePolicy.Word(UseCasePolicy.Kind.Exact, bytes32(uint256(uint160(address(dollar)))), 0, 0);
        words[1] = UseCasePolicy.Word(UseCasePolicy.Kind.Range, bytes32(0), 0, 200e6);
        words[2] = UseCasePolicy.Word(UseCasePolicy.Kind.Account, bytes32(0), 0, 0);
        UseCasePolicy.Call[] memory calls = new UseCasePolicy.Call[](1);
        calls[0] = UseCasePolicy.Call(address(venue), venue.close.selector, false, words);
        UseCasePolicy.Action[] memory rules = new UseCasePolicy.Action[](1);
        rules[0] = UseCasePolicy.Action(keccak256("add_margin"), market, keccak256("add_margin"), 200e6, 200e6, false, calls);
        policy.configure(bundle, rules, calls);
        action.capability = rules[0].id; action.market = market; action.calls = new ExecutionTypes.Call[](1);
        action.calls[0] = ExecutionTypes.Call(address(venue), address(0), 0, abi.encodeCall(venue.close, (address(dollar), 50e6, account)), 0);
    }
    function testPolicyBindsRecipientsAndCallSequences() public {
        ExecutionTypes.Action memory action = _policyAction();
        action.calls[0].data = abi.encodeCall(venue.close, (address(dollar), 50e6, address(0xBAD)));
        vm.expectRevert(); policy.prepare(creditId, account, action);
        action.calls[0].data = abi.encodeCall(venue.steal, (address(dollar), 50e6, account));
        vm.expectRevert(); policy.prepare(creditId, account, action);
    }
    function testActualPerpsExposureCannotExceedDeclaredSessionSpend() public {
        ExecutionTypes.Action memory action = _policyAction();
        (bytes32 beforeState,,,) = policy.prepare(creditId, account, action);
        uint256[16] memory state = venue.position(0); state[8] = 700e6; venue.setPosition(state);
        bytes[] memory results = new bytes[](1);
        vm.expectRevert(); policy.verifyResult(creditId, account, action, beforeState, results);
        action.exposureLimit = 200e6;
        assertEq(policy.verifyResult(creditId, account, action, beforeState, results).length, 0);
    }
    function testOnlyGovernanceCanConfigureAndVersionsAreImmutable() public {
        vm.prank(address(0xBAD)); vm.expectRevert(); reader.configure(bundle, config);
        _configure(UseCaseReader.UseCase.Spot); config.retainedBps = 10_000; vm.expectRevert(); reader.configure(bundle, config);
    }
}
