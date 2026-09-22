// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {MockERC20} from "../MockERC20.sol";
import {SettlementInbox} from "../../src/routing/SettlementInbox.sol";

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

    function claimWithoutDelivery(uint256 amount) external {
        HouseVault(vault).onSettlement(operationId, bytes32(0), token, amount);
    }
}

contract InboxCustodyTest is Test {
    MockERC20 token;
    HouseVault vault;
    address lp = address(0xBEEF);

    function setUp() public {
        token = new MockERC20();
        vault = new HouseVault(address(token), address(this), address(this));
        token.mint(lp, 1_000);
        vm.startPrank(lp);
        token.approve(address(vault), 1_000);
        vault.deposit(lp, 1_000);
        vm.stopPrank();
    }

    function testRegisteredCallerCannotMintWithoutTokenDelivery() public {
        ReportedInbox fake = new ReportedInbox(address(vault), address(token), lp);
        vault.setSettlementInbox(address(fake), true);
        vm.prank(lp);
        vault.configureLpInbox(address(fake), lp, 1);

        vm.expectRevert(HouseVault.AccountingMismatch.selector);
        fake.claimWithoutDelivery(1_000);
        assertEq(vault.shares(lp), 1_000);
        assertEq(token.balanceOf(address(vault)), 1_000);
    }

    function testManagerCannotRedirectLpShares() public {
        SettlementInbox inbox = new SettlementInbox(
            bytes32("lp"), address(vault), address(token), bytes32(0), 100, 100, lp, block.timestamp + 1 days
        );
        vault.setSettlementInbox(address(inbox), true);
        vm.expectRevert(HouseVault.InvalidInbox.selector);
        vault.configureLpInbox(address(inbox), address(this), 1);
    }
}
