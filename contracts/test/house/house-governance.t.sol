// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {HouseRegistry} from "../../src/house/HouseRegistry.sol";
import {HousePolicyGovernor} from "../../src/house/HousePolicyGovernor.sol";

contract HouseGovernanceTest is Test {
    MockERC20 token;
    HouseVault vault;
    HouseRegistry registry;
    HousePolicyGovernor governor;
    address house = address(0xA11CE);
    address lp = address(0xB0B);

    function setUp() public {
        token = new MockERC20();
        vault = new HouseVault(address(token), address(this), address(this));
        registry = new HouseRegistry(address(this));
        registry.register(house, address(vault), address(token), address(this));
        registry.setPolicy(house, 1, 500, 1 days, 365 days, 10_000, 100, 1_000);
        registry.setRiskPolicy(house, 15_000, 13_000, 12_000, 11_500, 11_000);
        governor = new HousePolicyGovernor(address(registry), address(vault), house, 0, 2 days, 1 days, 5_000, 1);
        registry.setPolicyGovernor(house, address(governor));
        token.mint(lp, 1_000);
        vm.startPrank(lp);
        token.approve(address(vault), 1_000);
        vault.deposit(lp, 1_000);
        vm.stopPrank();
        vm.warp(block.timestamp + vault.GOVERNANCE_HOLD());
    }

    function _policy() internal pure returns (HousePolicyGovernor.Policy memory) {
        return
            HousePolicyGovernor.Policy(
                2, 800, 1 days, 365 days, 9_000, 100, 500, 16_000, 14_000, 13_000, 12_000, 11_000
            );
    }

    function testLpVoteQueuesAndExecutesHousePolicy() public {
        vm.prank(lp);
        uint256 proposalId = governor.propose(_policy());
        vm.warp(block.timestamp + governor.votingDelay());
        vm.prank(lp);
        governor.vote(proposalId, true);
        vm.warp(block.timestamp + governor.votingPeriod());
        governor.queue(proposalId);
        vm.warp(block.timestamp + governor.timelock());
        governor.execute(proposalId);

        (
            uint256 version,
            uint256 maxLimit,
            uint256 minMaturity,
            uint256 maxMaturity,
            uint256 maxAprBps,
            uint256 maxOriginationFeeBps,
            uint256 maxCommitmentFeeBps,
            uint256 initialBps,
            uint256 maintenanceBps,
            uint256 watchBps,
            uint256 freezeBps,
            uint256 liquidationBps,
            bool riskConfigured,
            bool active
        ) = registry.policies(house);
        assertEq(version, 2);
        assertEq(maxLimit, 800);
        assertTrue(active);
    }

    function testNewDepositCannotVoteBeforeMaturity() public {
        address newLp = address(0xD00D);
        token.mint(newLp, 100);
        vm.startPrank(newLp);
        token.approve(address(vault), 100);
        vault.deposit(newLp, 100);
        vm.stopPrank();
        vm.prank(lp);
        uint256 proposalId = governor.propose(_policy());
        vm.warp(block.timestamp + governor.votingDelay());
        vm.prank(newLp);
        vm.expectRevert(HousePolicyGovernor.NoVotingPower.selector);
        governor.vote(proposalId, true);
    }

    function testVoteWeightUsesProposalSnapshot() public {
        vm.prank(lp);
        uint256 proposalId = governor.propose(_policy());

        address newLp = address(0xD00D);
        token.mint(newLp, 100);
        vm.startPrank(newLp);
        token.approve(address(vault), 100);
        vault.deposit(newLp, 100);
        vm.stopPrank();
        vm.warp(block.timestamp + vault.GOVERNANCE_HOLD());

        vm.prank(newLp);
        vm.expectRevert(HousePolicyGovernor.NoVotingPower.selector);
        governor.vote(proposalId, true);

        vm.prank(lp);
        governor.vote(proposalId, true);
    }

    function testManagerCannotBypassConfiguredGovernor() public {
        vm.expectRevert(HouseRegistry.Unauthorized.selector);
        registry.setPolicy(house, 3, 900, 1 days, 365 days, 9_000, 100, 500);
    }
}
