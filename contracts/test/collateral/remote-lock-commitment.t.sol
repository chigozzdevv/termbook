// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CollateralVault} from "../../src/collateral/CollateralVault.sol";
import {MockERC20} from "../MockERC20.sol";

contract ShortTransferFromToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - 1;
        return true;
    }
}

contract RemoteLockCommitmentTest is Test {
    MockERC20 token;
    CollateralVault vault;
    address owner = address(0xA11CE);
    address borrower = address(0xB0B);
    address recipient = address(0xCAFE);
    bytes32 lockId = keccak256("remote-lock");
    bytes32 creditId = keccak256("credit");

    function setUp() public {
        token = new MockERC20();
        token.mint(owner, 200);
        vault = new CollateralVault(address(token), block.chainid, address(this));
        vm.prank(owner);
        token.approve(address(vault), 200);
    }

    function _remoteLock(uint256 amount) internal {
        vm.prank(owner);
        vault.lockRemoteWithDeadline(lockId, creditId, borrower, owner, amount, recipient, block.timestamp + 1 days, 1);
    }

    function testCommitmentMatchesCoreNineFieldDigest() public {
        _remoteLock(100);
        bytes32 expected = keccak256(
            abi.encode(
                creditId,
                lockId,
                borrower,
                owner,
                address(vault),
                address(token),
                uint256(100),
                block.chainid,
                recipient
            )
        );
        assertEq(vault.lockCommitments(lockId), expected);
        assertEq(vm.load(address(vault), vault.lockCommitmentStorageSlot(lockId)), expected);
        assertEq(token.balanceOf(address(vault)), 100);
        (
            bytes32 storedCredit,
            address storedOwner,
            address storedAsset,
            uint256 sourceChain,
            uint256 amount,
            address storedRecipient,,
            uint256 revision,
            bool exists,
            bool released,
            bool seized
        ) = vault.lockInfo(lockId);
        assertEq(storedCredit, creditId);
        assertEq(storedOwner, owner);
        assertEq(storedAsset, address(token));
        assertEq(sourceChain, block.chainid);
        assertEq(amount, 100);
        assertEq(storedRecipient, recipient);
        assertEq(revision, 1);
        assertTrue(exists);
        assertFalse(released);
        assertFalse(seized);
    }

    function testLegacyLockHasNoRemoteCommitment() public {
        vm.prank(owner);
        vault.lockWithDeadline(lockId, creditId, owner, 100, recipient, block.timestamp + 1 days, 1);
        assertEq(vault.lockCommitments(lockId), bytes32(0));
        assertEq(token.balanceOf(address(vault)), 100);
    }

    function testDuplicateRemoteLockCannotChangeCommitment() public {
        _remoteLock(100);
        bytes32 original = vault.lockCommitments(lockId);
        vm.prank(owner);
        vm.expectRevert(CollateralVault.Exists.selector);
        vault.lockRemoteWithDeadline(
            lockId, creditId, address(0xBAD), owner, 100, recipient, block.timestamp + 1 days, 1
        );
        assertEq(vault.lockCommitments(lockId), original);
        assertEq(token.balanceOf(address(vault)), 100);
    }

    function testOwnerAuthorizationAndBorrowerRequired() public {
        vm.prank(borrower);
        vm.expectRevert(CollateralVault.Unauthorized.selector);
        vault.lockRemoteWithDeadline(lockId, creditId, borrower, owner, 100, recipient, block.timestamp + 1 days, 1);
        vm.prank(owner);
        vm.expectRevert(CollateralVault.InvalidBinding.selector);
        vault.lockRemoteWithDeadline(lockId, creditId, address(0), owner, 100, recipient, block.timestamp + 1 days, 1);
        assertEq(vault.lockCommitments(lockId), bytes32(0));
        assertFalse(vault.lockExists(lockId));
    }

    function testExpiredLockLeavesNoCommitment() public {
        vm.prank(owner);
        vm.expectRevert(CollateralVault.Expired.selector);
        vault.lockRemoteWithDeadline(lockId, creditId, borrower, owner, 100, recipient, block.timestamp - 1, 1);
        assertEq(vault.lockCommitments(lockId), bytes32(0));
        assertFalse(vault.lockExists(lockId));
    }

    function testRemoteLockChecksActualSourceChain() public {
        CollateralVault wrongChain = new CollateralVault(address(token), block.chainid + 1, address(this));
        vm.prank(owner);
        vm.expectRevert(CollateralVault.InvalidBinding.selector);
        wrongChain.lockRemoteWithDeadline(
            lockId, creditId, borrower, owner, 100, recipient, block.timestamp + 1 days, 1
        );
        assertEq(wrongChain.lockCommitments(lockId), bytes32(0));
    }

    function testFeeOnTransferCannotCreateCommitment() public {
        ShortTransferFromToken shortToken = new ShortTransferFromToken();
        shortToken.mint(owner, 100);
        CollateralVault shortVault = new CollateralVault(address(shortToken), block.chainid, address(this));
        vm.prank(owner);
        shortToken.approve(address(shortVault), 100);
        vm.prank(owner);
        vm.expectRevert(CollateralVault.InvalidAmount.selector);
        shortVault.lockRemoteWithDeadline(
            lockId, creditId, borrower, owner, 100, recipient, block.timestamp + 1 days, 1
        );
        assertEq(shortVault.lockCommitments(lockId), bytes32(0));
        assertFalse(shortVault.lockExists(lockId));
        assertEq(shortToken.balanceOf(address(shortVault)), 0);
    }
}
