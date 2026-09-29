// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/monad/collateral/VerifierRegistry.sol";
import {Types} from "../../src/shared/Types.sol";

contract MockReturnCancelVerifier {
    bool public unconsumed;
    address public immutable sourceVault;
    address public immutable sourceController;

    constructor(address vault, address controller) {
        sourceVault = vault;
        sourceController = controller;
    }

    function admission() external pure returns (uint256, uint256, bytes32) {
        return (1, 1, keccak256("ethereum-bootstrap"));
    }

    function lightClient() external view returns (address) { return address(this); }
    function proofMaxAge() external pure returns (uint256) { return 1 days; }
    function chainId() external pure returns (uint256) { return 1; }
    function consensusVersion() external pure returns (uint256) { return 1; }
    function bootstrapHash() external pure returns (bytes32) { return keccak256("ethereum-bootstrap"); }
    function verifyLock(bytes calldata, bytes calldata, address vault, bytes32 digest) external view returns (bool) {
        return vault == sourceVault && digest != bytes32(0);
    }

    function setUnconsumed(bool value) external { unconsumed = value; }

    function verifyUnconsumedAction(
        bytes calldata, bytes calldata, address controller, bytes32 actionHash, uint256 deadline
    ) external view returns (bool) {
        return unconsumed && controller == sourceController && actionHash != bytes32(0) && deadline < block.timestamp;
    }
}

contract RemoteReturnCancelTest is Test {
    MockERC20 private settlement;
    TermbookCore private core;
    HouseVault private vault;
    MockReturnCancelVerifier private verifier;
    uint256 private houseKey = 0xBEEF;
    uint256 private borrowerKey = 0xCAFE;
    address private sourceAsset = address(0x1234);
    address private sourceVault = address(0x4567);
    address private sourceRecoveryVault = address(0x789A);
    address private sourceController = address(0xABCD);

    function setUp() public {
        settlement = new MockERC20();
        core = TermbookCore(deployCode("TermbookCore.sol:TermbookCore", abi.encode(address(this), address(this), address(0))));
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(settlement), address(core), address(this), address(0), address(0))));
        verifier = new MockReturnCancelVerifier(sourceVault, sourceController);
        VerifierRegistry registry = new VerifierRegistry(address(this));
        core.setVerifierRegistry(address(registry));
        registry.setVerifier(1, address(verifier), 1, 1 days);
        core.setSourceCollateralVault(1, sourceAsset, sourceVault);
        core.setSourceRecoveryVault(1, sourceAsset, sourceRecoveryVault);
        core.setRemoteSalePolicy(
            1, sourceAsset, address(settlement), address(new MockRemoteSaleOracle()),
            keccak256("ETH/settlement"), 18, 9_000, 1_000e18
        );
        settlement.mint(address(this), 1_000e18);
        settlement.approve(address(vault), 1_000e18);
        vault.deposit(address(this), 1_000e18);
    }

    function _abortedCredit() private returns (bytes32 creditId, bytes32 lockId) {
        address borrower = vm.addr(borrowerKey);
        address house = vm.addr(houseKey);
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("remote-return-cancel-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = 1;
        quote.collateralVault = sourceVault;
        quote.collateralAsset = sourceAsset;
        quote.collateralAmount = 100e18;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(settlement);
        quote.limit = 100e18;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = quote.setupDeadline;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        core.acceptQuote(quote);
        creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        lockId = keccak256("remote-lock");
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, lockId);
        core.proveCollateral(creditId, 1, hex"01", hex"02");
        vm.warp(quote.setupDeadline + 1);
        core.expireSetup(creditId);
    }

    function testExpiredReturnRequiresFinalizedNonexecutionProof() public {
        (bytes32 creditId, bytes32 lockId) = _abortedCredit();
        address borrower = vm.addr(borrowerKey);
        vm.prank(borrower);
        core.authorizeReturn(creditId, lockId, 20e18);
        bytes32 firstHash = core.remoteReturnActionHash(creditId);
        uint256 deadline = core.remoteReturnDeadline(creditId);
        assertEq(deadline, block.timestamp + 7 days);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        vm.warp(deadline + 1);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        verifier.setUnconsumed(true);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        assertEq(core.pendingRemoteReturn(creditId), 0);
        assertEq(core.remoteReturnActionHash(creditId), bytes32(0));
        assertEq(core.remoteReturnDeadline(creditId), 0);
        assertEq(core.creditDetails(creditId).collateralAmount, 100e18);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        vm.prank(borrower);
        core.authorizeReturn(creditId, lockId, 20e18);
        assertTrue(core.remoteReturnActionHash(creditId) != firstHash);
    }
}
