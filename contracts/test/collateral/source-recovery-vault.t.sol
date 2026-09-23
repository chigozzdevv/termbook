// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SourceRecoveryVault} from "../../src/collateral/SourceRecoveryVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract RecoveryControllerCaller {
    function record(SourceRecoveryVault vault, bytes32 creditId, uint256 amount) external {
        vault.recordSeizure(creditId, amount);
    }
}

contract SourceRecoveryVaultTest is Test {
    MockERC20 token;
    SourceRecoveryVault recovery;
    RecoveryControllerCaller controller;
    uint256 signerKey = 0xBEEF;
    bytes32 creditId = keccak256("credit");
    bytes32 operationId = keccak256("operation");
    address deposit = address(0xD00D);

    function setUp() public {
        token = new MockERC20();
        recovery = new SourceRecoveryVault(address(token), 101, address(this), vm.addr(signerKey));
        controller = new RecoveryControllerCaller();
        recovery.setController(address(controller));
        token.mint(address(recovery), 500);
        controller.record(recovery, creditId, 500);
    }

    function _signature(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _funding() internal view returns (SourceRecoveryVault.Funding memory funding) {
        funding = SourceRecoveryVault.Funding({
            creditId: creditId,
            operationId: operationId,
            inbox: address(0xABCD),
            depositAddress: deposit,
            amount: 300,
            quoteHash: keccak256("signed quote"),
            nonce: 1,
            deadline: block.timestamp + 1 days
        });
    }

    function testFundAndAttributePartialSourceRefund() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        recovery.fund(funding, _signature(recovery.fundingDigest(funding)));
        assertEq(token.balanceOf(deposit), 300);
        assertEq(recovery.held(creditId), 200);
        (, uint256 inFlightBefore) = recovery.inFlight(operationId);
        assertEq(inFlightBefore, 300);
        bytes32 refundTx = keccak256("refund tx");
        token.mint(address(recovery), 100);
        uint256 deadline = block.timestamp + 1 days;
        recovery.recordSourceRefund(operationId, refundTx, 100, 1, deadline, _signature(
            recovery.refundDigest(operationId, refundTx, 100, 1, deadline)
        ));
        assertEq(recovery.held(creditId), 300);
        (, uint256 inFlightAfter) = recovery.inFlight(operationId);
        assertEq(inFlightAfter, 200);
    }

    function testSignatureBindsDestinationAndPreventReplay() public {
        SourceRecoveryVault.Funding memory funding = _funding();
        bytes memory signature = _signature(recovery.fundingDigest(funding));
        funding.depositAddress = address(0xBAD);
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.fund(funding, signature);
        funding.depositAddress = deposit;
        recovery.fund(funding, signature);
        vm.expectRevert(SourceRecoveryVault.Invalid.selector);
        recovery.fund(funding, signature);
    }
}
