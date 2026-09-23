// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NativeCollateralVault} from "../../src/collateral/NativeCollateralVault.sol";
import {SafeTransferLib} from "../../src/shared/SafeTransferLib.sol";

contract MockWrappedNative {
    mapping(address => uint256) public balanceOf;
    bool public shortMint;
    bool public shortWithdrawal;
    bool public failTransfer;

    function setShortMint(bool value) external {
        shortMint = value;
    }

    function setShortWithdrawal(bool value) external {
        shortWithdrawal = value;
    }

    function setFailTransfer(bool value) external {
        failTransfer = value;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += shortMint ? msg.value - 1 : msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        uint256 sent = shortWithdrawal ? amount - 1 : amount;
        (bool ok,) = msg.sender.call{value: sent}("");
        require(ok);
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (failTransfer) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract RejectNative {
    receive() external payable {
        revert();
    }
}

contract NativeCollateralVaultTest is Test {
    MockWrappedNative wrapped;
    NativeCollateralVault vault;
    address owner = address(0xA11CE);
    address recipient = address(0xB0B);
    address buyer = address(0xBEEF);
    bytes32 creditId = keccak256("credit");
    bytes32 lockId = keccak256("lock");

    function setUp() public {
        wrapped = new MockWrappedNative();
        vault = new NativeCollateralVault(address(wrapped), block.chainid, address(this));
        vm.deal(owner, 10 ether);
    }

    function _lock(address returnRecipient) internal {
        vm.prank(owner);
        vault.lockNativeWithDeadline{value: 2 ether}(
            lockId, creditId, owner, 2 ether, returnRecipient, block.timestamp + 1 days, 1
        );
    }

    function testNativeDepositWrapsExactAmountAndBindsLock() public {
        uint256 ownerBefore = owner.balance;
        _lock(recipient);
        assertEq(owner.balance, ownerBefore - 2 ether);
        assertEq(wrapped.balanceOf(address(vault)), 2 ether);
        assertEq(address(vault).balance, 0);
        (
            bytes32 storedCredit,
            address storedOwner,
            address storedAsset,
            uint256 sourceChain,
            uint256 amount,
            address storedRecipient,
            uint256 deadline,
            uint256 revision,
            bool exists,
            bool released,
            bool seized
        ) = vault.lockInfo(lockId);
        assertEq(storedCredit, creditId);
        assertEq(storedOwner, owner);
        assertEq(storedAsset, address(wrapped));
        assertEq(sourceChain, block.chainid);
        assertEq(amount, 2 ether);
        assertEq(storedRecipient, recipient);
        assertEq(deadline, block.timestamp + 1 days);
        assertEq(revision, 1);
        assertTrue(exists);
        assertFalse(released);
        assertFalse(seized);
    }

    function testOnlyNativeDepositAndExactAmount() public {
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.NativeDepositRequired.selector);
        vault.lock(lockId, creditId, owner, 2 ether, recipient);
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.InvalidAmount.selector);
        vault.lockNativeWithDeadline{value: 1 ether}(
            lockId, creditId, owner, 2 ether, recipient, block.timestamp + 1 days, 1
        );
        assertFalse(vault.lockExists(lockId));
    }

    function testWrongChainRejectedAtDeploymentAndUse() public {
        vm.expectRevert(NativeCollateralVault.InvalidChain.selector);
        new NativeCollateralVault(address(wrapped), block.chainid + 1, address(this));
        vm.chainId(block.chainid + 1);
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.InvalidChain.selector);
        vault.lockNative{value: 1 ether}(lockId, creditId, owner, 1 ether, recipient);
    }

    function testShortWrapRevertsWithoutRecordingLock() public {
        wrapped.setShortMint(true);
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.InvalidAmount.selector);
        vault.lockNative{value: 2 ether}(lockId, creditId, owner, 2 ether, recipient);
        assertFalse(vault.lockExists(lockId));
        assertEq(wrapped.balanceOf(address(vault)), 0);
    }

    function testReturnUnwrapsToOriginalRecipientAndPreventsReplay() public {
        _lock(recipient);
        uint256 nativeBefore = recipient.balance;
        vault.release(lockId, recipient, 1 ether, 7);
        assertEq(recipient.balance - nativeBefore, 1 ether);
        assertEq(wrapped.balanceOf(address(vault)), 1 ether);
        assertEq(wrapped.balanceOf(recipient), 0);
        vm.expectRevert(NativeCollateralVault.Used.selector);
        vault.release(lockId, recipient, 1 ether, 7);
        vault.release(lockId, recipient, 1 ether, 8);
        assertEq(recipient.balance - nativeBefore, 2 ether);
        assertEq(wrapped.balanceOf(address(vault)), 0);
        assertTrue(vault.consumed(lockId));
    }

    function testReturnCannotChangeRecipientOrBypassCore() public {
        _lock(recipient);
        vm.expectRevert(NativeCollateralVault.InvalidBinding.selector);
        vault.release(lockId, buyer, 1 ether, 1);
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.Unauthorized.selector);
        vault.release(lockId, recipient, 1 ether, 1);
    }

    function testRevertingNativeReturnRollsBackLock() public {
        RejectNative rejecting = new RejectNative();
        _lock(address(rejecting));
        vm.expectRevert(NativeCollateralVault.NativeTransferFailed.selector);
        vault.release(lockId, address(rejecting), 1 ether, 1);
        (,, uint256 remaining,,,) = vault.locks(lockId);
        assertEq(remaining, 2 ether);
        assertEq(wrapped.balanceOf(address(vault)), 2 ether);
        assertFalse(vault.releaseUsed(keccak256(abi.encode(lockId, address(rejecting), 1 ether, 1))));
    }

    function testShortWithdrawalRollsBackReturn() public {
        _lock(recipient);
        wrapped.setShortWithdrawal(true);
        vm.expectRevert(NativeCollateralVault.InvalidAmount.selector);
        vault.release(lockId, recipient, 1 ether, 1);
        assertEq(recipient.balance, 0);
        assertEq(wrapped.balanceOf(address(vault)), 2 ether);
    }

    function testSeizureTransfersWrappedToBuyer() public {
        _lock(recipient);
        vault.seize(lockId, buyer, 2 ether);
        assertEq(wrapped.balanceOf(buyer), 2 ether);
        assertEq(wrapped.balanceOf(address(vault)), 0);
        assertEq(buyer.balance, 0);
        assertTrue(vault.consumed(lockId));
    }

    function testOnlyCoreCanSeize() public {
        _lock(recipient);
        vm.prank(buyer);
        vm.expectRevert(NativeCollateralVault.Unauthorized.selector);
        vault.seize(lockId, buyer, 1 ether);
        assertEq(wrapped.balanceOf(buyer), 0);
    }

    function testPausedVaultStillAllowsReturn() public {
        _lock(recipient);
        vault.setPaused(true);
        uint256 beforeBalance = recipient.balance;
        vault.release(lockId, recipient, 1 ether, 1);
        assertEq(recipient.balance - beforeBalance, 1 ether);
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.Unauthorized.selector);
        vault.lockNative{value: 1 ether}(keccak256("next"), creditId, owner, 1 ether, recipient);
    }

    function testRevertingWrappedTransferRollsBackSeizure() public {
        _lock(recipient);
        wrapped.setFailTransfer(true);
        vm.expectRevert(SafeTransferLib.TransferFailed.selector);
        vault.seize(lockId, buyer, 1 ether);
        (,, uint256 remaining,,,) = vault.locks(lockId);
        assertEq(remaining, 2 ether);
        assertEq(wrapped.balanceOf(address(vault)), 2 ether);
        assertEq(wrapped.balanceOf(buyer), 0);
    }

    function testDirectNativeTransferRejected() public {
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.NativeDepositRequired.selector);
        payable(address(vault)).transfer(1 ether);
        assertEq(address(vault).balance, 0);
    }

    function testExpiredAndDuplicateLocksRejected() public {
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.Expired.selector);
        vault.lockNativeWithDeadline{value: 1 ether}(
            lockId, creditId, owner, 1 ether, recipient, block.timestamp - 1, 1
        );
        _lock(recipient);
        vm.prank(owner);
        vm.expectRevert(NativeCollateralVault.Exists.selector);
        vault.lockNative{value: 1 ether}(lockId, creditId, owner, 1 ether, recipient);
    }
}
