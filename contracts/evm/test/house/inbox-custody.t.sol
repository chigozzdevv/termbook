// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {MockERC20} from "../MockERC20.sol";
import {SettlementInbox} from "../../src/monad/routing/SettlementInbox.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";

contract ReportedInbox {
    bytes32 public constant operationId = bytes32("fake");
    address public immutable vault;
    address public immutable token;
    address public immutable refundRecipient;

    constructor(address vault_, address token_, address refundRecipient_) {
        vault = vault_;
        token = token_;
        refundRecipient = refundRecipient_;
    }

    function creditId() external pure returns (bytes32) {
        return bytes32(0);
    }

}

contract InboxCustodyTest is Test {
    MockERC20 token;
    HouseVault vault;
    InboxFactory factory;
    address lp = address(0xBEEF);

    function setUp() public {
        token = new MockERC20();
        factory = InboxFactory(deployCode("InboxFactory.sol:InboxFactory", abi.encode(address(this))));
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(token), address(this), address(this), address(factory), address(0))));
        token.mint(lp, 1_000);
        vm.startPrank(lp);
        token.approve(address(vault), 1_000);
        vault.deposit(lp, 1_000);
        vm.stopPrank();
    }

    function testManagerCannotRegisterUnprovenInbox() public {
        ReportedInbox fake = new ReportedInbox(address(vault), address(token), lp);
        vm.expectRevert(HouseVault.InvalidInbox.selector);
        vault.setSettlementInbox(address(fake), true);
    }

    function testRegisteredCallerCannotMintWithoutTokenDelivery() public {
        bytes32 operationId = bytes32("lp");
        SettlementInbox inbox = SettlementInbox(factory.create(
            operationId, address(vault), address(token), bytes32(0), 100, 100, lp, block.timestamp + 1 days
        ));
        vault.setSettlementInbox(address(inbox), true);
        vm.prank(lp);
        vault.configureLpInbox(address(inbox), lp, 1);

        vm.expectRevert(HouseVault.AccountingMismatch.selector);
        vm.prank(address(inbox));
        vault.onSettlement(operationId, bytes32(0), address(token), 1_000);
        assertEq(vault.shares(lp), 1_000);
        assertEq(token.balanceOf(address(vault)), 1_000);
    }

    function testManagerCannotRedirectLpShares() public {
        SettlementInbox inbox = SettlementInbox(factory.create(
            bytes32("lp"), address(vault), address(token), bytes32(0), 100, 100, lp, block.timestamp + 1 days
        ));
        vault.setSettlementInbox(address(inbox), true);
        vm.expectRevert(HouseVault.InvalidInbox.selector);
        vault.configureLpInbox(address(inbox), address(this), 1);
    }

    function testGuardianCanBeConfiguredForSeparateManagerAtDeployment() public {
        HouseVault guarded = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(token), address(this), lp, address(factory), address(factory))));
        assertEq(guarded.pauseGuardian(), address(factory));
        vm.prank(address(factory));
        guarded.setPaused(true);
        assertTrue(guarded.paused());
    }
}
