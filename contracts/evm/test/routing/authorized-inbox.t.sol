// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {RouteRegistry} from "../../src/monad/routing/RouteRegistry.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {SettlementInbox} from "../../src/monad/routing/SettlementInbox.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockSettlementReceiver} from "../MockSettlementReceiver.sol";
import {WormholeTermbookMessages as WormholeMessages} from "../../src/shared/collateral/WormholeTermbookMessages.sol";

contract MockRecoveryWormhole {
    bytes public lastPayload;

    function chainId() external pure returns (uint16) {
        return 48;
    }

    function messageFee() external pure returns (uint256) {
        return 1 wei;
    }

    function publishMessage(uint32, bytes memory payload, uint8 consistency) external payable returns (uint64) {
        require(msg.value == 1 wei && consistency == 0, "invalid-publish");
        lastPayload = payload;
        return 9;
    }
}

contract MockRouteCore {
    address public vault;
    address public keeper;
    address public sourceAsset;
    uint256 public debt = 500;

    function set(address vault_, address keeper_, address sourceAsset_) external {
        vault = vault_;
        keeper = keeper_;
        sourceAsset = sourceAsset_;
    }

    function creditVault(bytes32) external view returns (address) {
        return vault;
    }

    function creditDebt(bytes32) external view returns (uint256) {
        return debt;
    }

    function applySettlement(bytes32 id, address inbox, uint256 amount) external {
        require(msg.sender == vault);
        HouseVault(vault).applyRepaymentSettlement(id, inbox, amount, amount, 0, 0);
        debt -= amount;
    }

    function creditFacility(bytes32) external pure returns (uint8) {
        return 8;
    }

    function remoteCollateral(bytes32) external pure returns (bool) {
        return true;
    }

    function recoveryKeepers(address candidate) external view returns (bool) {
        return candidate == keeper;
    }

    function recoveryRefundRecipientOf(bytes32) external view returns (address) {
        return keeper;
    }

    function minimumRemoteRecoveryProceeds(bytes32, uint256) external pure returns (uint256) {
        return 350;
    }

    function remoteRecoveryContext(bytes32) external view returns (uint256, address, address) {
        return (1, sourceAsset, keeper);
    }
}

contract AuthorizedInboxTest is Test {
    InboxFactory factory;
    RouteRegistry registry;
    HouseVault house;
    MockERC20 token;
    MockSettlementReceiver adapter;
    MockRouteCore core;
    uint256 payerKey = 0xBEEF;
    address payer;
    bytes32 routeId = keccak256("route");

    function testRepaymentCapDoesNotAuthorizeOverflowDebtPayment() public {
        InboxFactory.Operation memory op = _operation(0);
        SettlementInbox inbox = SettlementInbox(factory.createAuthorized(op, _signature(op)));
        assertTrue(inbox.boundedRepayment());
        token.mint(address(inbox), op.maxReceived + 1);
        inbox.notifyReceipt(op.maxReceived);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        inbox.settleUntracked(1);
        vm.warp(uint256(op.deadline) + 1);
        inbox.refundUntracked(1);
        assertEq(inbox.untrackedRefunded(), 1);
        assertEq(token.balanceOf(op.refundRecipient), 1);
    }

    function setUp() public {
        token = new MockERC20();
        adapter = new MockSettlementReceiver();
        core = new MockRouteCore();
        factory = InboxFactory(deployCode("InboxFactory.sol:InboxFactory", abi.encode(address(this))));
        registry = new RouteRegistry(address(this));
        house = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(token), address(core), address(this), address(factory), address(0))));
        payer = vm.addr(payerKey);
        core.set(address(house), payer, address(token));
        registry.setRoute(
            routeId,
            address(adapter),
            keccak256(abi.encode(uint256(1), address(token), block.chainid, address(token))),
            1_000
        );
        factory.setRouteRegistry(address(registry));
    }

    function _operation(uint8 kind) internal view returns (InboxFactory.Operation memory op) {
        op.operationId = keccak256(abi.encode("operation", kind));
        op.kind = kind;
        op.payer = payer;
        op.sourceChain = 1;
        op.sourceAsset = address(token);
        op.vault = address(house);
        op.token = address(token);
        op.creditId = kind == 2 ? bytes32(0) : keccak256("credit");
        op.maxAmountIn = 500;
        op.minOut = 400;
        op.maxReceived = 600;
        op.sourceRefund = payer;
        op.refundRecipient = payer;
        op.deadline = block.timestamp + 1 days;
        op.routeId = routeId;
        op.routeVersion = bytes32(uint256(1));
        op.lpRecipient = kind == 2 ? payer : address(0);
        op.minShares = kind == 2 ? 100 : 0;
    }

    function _signature(InboxFactory.Operation memory op) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, factory.operationDigest(op));
        return abi.encodePacked(r, s, v);
    }

    function testRepaymentAndRecoveryRegistrationsBindTheHouse() public {
        for (uint8 kind = 0; kind < 2; kind++) {
            InboxFactory.Operation memory op = _operation(kind);
            address inbox = factory.createAuthorized(op, _signature(op));
            assertEq(factory.inboxOf(op.operationId), inbox);
            assertEq(factory.operationDigestOf(op.operationId), factory.operationDigest(op));
            assertTrue(house.settlementInboxes(inbox));
            assertEq(SettlementInbox(inbox).creditId(), op.creditId);
        }
    }

    function testRecoveryCompletionRequiresAllocatedProceedsAndPreservesLateReceipts() public {
        InboxFactory.Operation memory op = _operation(1);
        SettlementInbox inbox = SettlementInbox(factory.createAuthorized(op, _signature(op)));
        assertEq(factory.pendingRecoveryCount(op.creditId), 1);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.settleRecoveryOperation(op.operationId);
        token.mint(address(this), 500);
        token.approve(address(house), 500);
        house.deposit(address(this), 500);
        vm.startPrank(address(core));
        house.reserve(op.creditId, 500);
        house.fundDraw(op.creditId, payer, 500);
        vm.stopPrank();
        token.mint(address(inbox), 400);
        inbox.notifyAll();
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.settleRecoveryOperation(op.operationId);
        inbox.settle(400);
        factory.settleRecoveryOperation(op.operationId);
        assertEq(factory.pendingRecoveryCount(op.creditId), 0);
        assertEq(house.drawnPrincipal(), 100);
        assertEq(core.debt(), 100);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.settleRecoveryOperation(op.operationId);
        token.mint(address(inbox), 100);
        inbox.notifyAll();
        inbox.settle(100);
        assertEq(core.debt(), 0);
        assertEq(inbox.received(), inbox.applied() + inbox.refunded() + inbox.available());
        assertEq(token.balanceOf(address(house)), 500);
    }

    function testOverflowRecoveryReducesDebtBeforeRouteCompletion() public {
        InboxFactory.Operation memory op = _operation(1);
        op.maxReceived = 400;
        SettlementInbox inbox = SettlementInbox(factory.createAuthorized(op, _signature(op)));
        token.mint(address(this), 500);
        token.approve(address(house), 500);
        house.deposit(address(this), 500);
        vm.startPrank(address(core));
        house.reserve(op.creditId, 500);
        house.fundDraw(op.creditId, payer, 500);
        vm.stopPrank();
        token.mint(address(inbox), 501);
        inbox.notifyReceipt(400);
        inbox.settle(400);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.settleRecoveryOperation(op.operationId);
        vm.expectRevert(SettlementInbox.Nothing.selector);
        inbox.settleUntracked(101);
        inbox.settleUntracked(100);
        assertEq(core.debt(), 0);
        assertEq(inbox.untrackedApplied(), 100);
        assertEq(inbox.received(), 400);
        assertEq(inbox.applied(), 400);
        vm.warp(op.deadline + 1);
        inbox.refundUntracked(1);
        factory.settleRecoveryOperation(op.operationId);
        assertEq(factory.pendingRecoveryCount(op.creditId), 0);
        assertEq(token.balanceOf(address(house)), 500);
        assertEq(token.balanceOf(address(inbox)), 0);
    }

    function testEthereumRecoveryRegistrationPublishesAndRepublishesOperation() public {
        MockRecoveryWormhole wormhole = new MockRecoveryWormhole();
        factory.configureEthereumWormhole(address(wormhole));
        InboxFactory.Operation memory op = _operation(1);
        vm.deal(address(this), 2 wei);
        address inbox = factory.createAuthorized{value: 1 wei}(op, _signature(op));
        bytes32 digest = factory.operationDigest(op);
        assertEq(
            wormhole.lastPayload(),
            abi.encode(WormholeMessages.RECOVERY, keccak256(abi.encode(op.operationId, digest, inbox)))
        );
        assertTrue(factory.recoveryVaaPublished(op.operationId));
        assertEq(factory.recoveryVaaSequenceOf(op.operationId), 9);
        factory.republishEthereumRecoveryOperation{value: 1 wei}(op.operationId);
        assertEq(factory.recoveryVaaSequenceOf(op.operationId), 9);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.republishEthereumRecoveryOperation(bytes32(uint256(1)));
    }

    function testLpRegistrationBindsShareRecipientAndMinimum() public {
        InboxFactory.Operation memory op = _operation(2);
        address inbox = factory.createAuthorized(op, _signature(op));
        assertEq(house.lpInboxRecipient(inbox), payer);
        assertEq(house.lpInboxMinShares(inbox), 100);
    }

    function testLpDeliveryMintsBoundShares() public {
        InboxFactory.Operation memory op = _operation(2);
        SettlementInbox inbox = SettlementInbox(factory.createAuthorized(op, _signature(op)));
        token.mint(address(inbox), 500);
        inbox.notifyAll();
        inbox.settle(500);
        assertEq(house.shares(payer), 500);
        assertEq(house.freeCash(), 500);
        assertTrue(house.lpInboxMinted(address(inbox)));
        assertEq(house.lpInboxShares(address(inbox)), house.shares(payer));
    }

    function testLpPayerCanCancelFundedInboxAndRefundLateReceipts() public {
        InboxFactory.Operation memory op = _operation(2);
        op.refundRecipient = address(0xD00D);
        SettlementInbox inbox = SettlementInbox(factory.createAuthorized(op, _signature(op)));
        token.mint(address(inbox), 300);
        inbox.notifyAll();
        vm.prank(op.refundRecipient);
        vm.expectRevert(SettlementInbox.InvalidRecipient.selector);
        inbox.cancel();
        vm.prank(payer);
        inbox.cancel();
        vm.expectRevert(SettlementInbox.Expired.selector);
        inbox.settle(300);
        inbox.refund(300);
        token.mint(address(inbox), 200);
        inbox.notifyAll();
        inbox.refund(200);
        assertEq(token.balanceOf(op.refundRecipient), 500);
        assertEq(house.shares(payer), 0);
        assertEq(inbox.available(), 0);
    }

    function testLpSignedRevisionResolvesFailedMintWithoutChangingRecipients() public {
        InboxFactory.Operation memory op = _operation(2);
        op.minShares = 501;
        SettlementInbox inbox = SettlementInbox(factory.createAuthorized(op, _signature(op)));
        token.mint(address(inbox), 500);
        inbox.notifyAll();
        vm.expectRevert(SettlementInbox.ReceiverFailed.selector);
        inbox.settle(500);
        uint256 deadline = block.timestamp + 2 days;
        bytes32 digest = inbox.lpRevisionDigest(450, 550, 500, deadline, 2, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        vm.expectRevert(SettlementInbox.InvalidRecipient.selector);
        inbox.reviseLp(450, 550, 499, deadline, 2, deadline, signature);
        inbox.reviseLp(450, 550, 500, deadline, 2, deadline, signature);
        vm.expectRevert(SettlementInbox.InvalidRecipient.selector);
        inbox.reviseLp(450, 550, 500, deadline, 2, deadline, signature);
        inbox.settle(500);
        assertEq(house.shares(payer), 500);
        assertEq(inbox.lpRevision(), 2);
        token.mint(address(inbox), 50);
        inbox.notifyAll();
        inbox.refund(50);
        assertEq(token.balanceOf(payer), 50);
        vm.prank(payer);
        vm.expectRevert(SettlementInbox.InvalidRecipient.selector);
        inbox.reviseLp(450, 550, 500, deadline, 3, deadline, "");
    }

    function testLpDeliveryCannotMintWhileDepositsClosed() public {
        InboxFactory.Operation memory op = _operation(2);
        SettlementInbox inbox = SettlementInbox(factory.createAuthorized(op, _signature(op)));
        token.mint(address(inbox), 500);
        inbox.notifyAll();
        house.setDepositsOpen(false);
        vm.expectRevert(SettlementInbox.ReceiverFailed.selector);
        inbox.settle(500);
        assertEq(inbox.available(), 500);
        assertEq(house.shares(payer), 0);
    }

    function testSignatureCannotChangeRecipientOrRefund() public {
        InboxFactory.Operation memory op = _operation(2);
        bytes memory signature = _signature(op);
        op.refundRecipient = address(0xD00D);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
        op.refundRecipient = payer;
        op.lpRecipient = address(0xD00D);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
    }

    function testRecoveryCannotRedirectSourceRefundOrSurplus() public {
        InboxFactory.Operation memory op = _operation(1);
        op.sourceRefund = address(0xD00D);
        bytes memory signature = _signature(op);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
        op.sourceRefund = payer;
        op.refundRecipient = address(0xD00D);
        signature = _signature(op);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
    }

    function testRecoveryRequiresOracleFloor() public {
        InboxFactory.Operation memory op = _operation(1);
        op.minOut = 349;
        bytes memory signature = _signature(op);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
    }

    function testRecoveryCannotSwitchTheCreditSourceAssetOrChain() public {
        InboxFactory.Operation memory op = _operation(1);
        op.sourceChain = 2;
        op.routeId = keccak256("other-chain-route");
        registry.setRoute(
            op.routeId,
            address(adapter),
            keccak256(abi.encode(op.sourceChain, op.sourceAsset, block.chainid, op.token)),
            1_000
        );
        bytes memory signature = _signature(op);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);

        op = _operation(1);
        op.sourceAsset = address(adapter);
        op.routeId = keccak256("other-asset-route");
        registry.setRoute(
            op.routeId,
            address(adapter),
            keccak256(abi.encode(op.sourceChain, op.sourceAsset, block.chainid, op.token)),
            1_000
        );
        signature = _signature(op);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
    }

    function testDisabledRouteAndReplayFail() public {
        InboxFactory.Operation memory op = _operation(0);
        bytes memory signature = _signature(op);
        registry.disable(routeId);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
        registry.setRoute(
            routeId,
            address(adapter),
            keccak256(abi.encode(uint256(1), address(token), block.chainid, address(token))),
            1_000
        );
        op.routeVersion = bytes32(uint256(2));
        signature = _signature(op);
        factory.createAuthorized(op, signature);
        vm.expectRevert(InboxFactory.Invalid.selector);
        factory.createAuthorized(op, signature);
    }
}
