// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/collateral/VerifierRegistry.sol";
import {Types} from "../../src/shared/Types.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";

contract MockSolanaProofVerifier {
    bytes32 public expectedLockDigest;

    function admission() external pure returns (uint256, uint256, bytes32) {
        return (99, 1, keccak256("solana-bootstrap"));
    }

    function lightClient() external view returns (address) {
        return address(this);
    }

    function proofMaxAge() external pure returns (uint256) {
        return 1 days;
    }

    function chainId() external pure returns (uint256) {
        return 99;
    }

    function consensusVersion() external pure returns (uint256) {
        return 1;
    }

    function bootstrapHash() external pure returns (bytes32) {
        return keccak256("solana-bootstrap");
    }

    function setExpectedLockDigest(bytes32 digest) external {
        expectedLockDigest = digest;
    }

    function verifySolanaLock(bytes calldata, bytes calldata, bytes32, bytes32, bytes32 digest)
        external
        view
        returns (bool)
    {
        return digest != bytes32(0) && digest == expectedLockDigest;
    }

    function verifySolanaAction(bytes calldata, bytes calldata, bytes32, bytes32, bytes32, bytes32)
        external
        pure
        returns (bool)
    {
        return false;
    }
}

contract SolanaQuoteTest is Test {
    uint256 private constant SOURCE_CHAIN = 99;
    bytes32 private constant GENESIS = keccak256("solana-genesis");
    bytes32 private constant PROGRAM = keccak256("solana-program");
    bytes32 private constant RECOVERY = keccak256("solana-recovery");
    bytes32 private constant OWNER = keccak256("solana-owner");
    bytes32 private constant RETURN_RECIPIENT = keccak256("solana-return");

    uint256 private houseKey = 0xBEEF;
    uint256 private borrowerKey = 0xCAFE;
    address private house;
    address private borrower;
    MockERC20 private settlement;
    TermbookCore private core;
    HouseVault private vault;
    VerifierRegistry private registry;
    MockSolanaProofVerifier private verifier;
    MockRemoteSaleOracle private oracle;

    function setUp() public {
        settlement = new MockERC20();
        core = new TermbookCore(address(this), address(this), address(0));
        vault = new HouseVault(address(settlement), address(core), address(this), address(0), address(0));
        registry = new VerifierRegistry(address(this));
        verifier = new MockSolanaProofVerifier();
        oracle = new MockRemoteSaleOracle();
        core.setVerifierRegistry(address(registry));
        registry.setVerifier(SOURCE_CHAIN, address(verifier), 1, 1 days);
        core.setSolanaMarket(SOURCE_CHAIN, GENESIS, PROGRAM, RECOVERY);
        core.setRemoteSalePolicy(
            SOURCE_CHAIN,
            core.solanaAlias(GENESIS, core.SOLANA_NATIVE_ASSET_ID()),
            address(settlement),
            address(oracle),
            keccak256("SOL/settlement"),
            9,
            9_000,
            100_000_000_000
        );
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        settlement.mint(address(this), 100);
        settlement.approve(address(vault), 100);
        vault.deposit(address(this), 100);
    }

    function _quote() private view returns (Types.SolanaQuote memory solana) {
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = core.solanaAlias(GENESIS, OWNER);
        quote.intentId = keccak256("solana-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = SOURCE_CHAIN;
        quote.collateralVault = core.solanaAlias(GENESIS, PROGRAM);
        quote.collateralAsset = core.solanaAlias(GENESIS, core.SOLANA_NATIVE_ASSET_ID());
        quote.collateralAmount = 10_000_000_000;
        quote.returnRecipient = core.solanaAlias(GENESIS, RETURN_RECIPIENT);
        quote.settlementAsset = address(settlement);
        quote.limit = 100;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = block.timestamp + 1 days;
        quote.termsHash = keccak256("terms");
        solana = Types.SolanaQuote(
            quote,
            GENESIS,
            PROGRAM,
            core.SOLANA_NATIVE_ASSET_ID(),
            OWNER,
            RETURN_RECIPIENT,
            RECOVERY,
            1
        );
    }

    function _signedQuote() private view returns (Types.SolanaQuote memory solana) {
        solana = _quote();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.solanaQuoteDigest(solana));
        solana.quote.signature = abi.encodePacked(r, s, v);
    }

    function testSolanaQuotePinsFullIdentityAndProofDigest() public {
        Types.SolanaQuote memory solana = _signedQuote();
        vm.prank(borrower);
        core.acceptSolanaQuote(solana);
        bytes32 creditId = keccak256(abi.encode(solana.quote.intentId, borrower, house, solana.quote.nonce));
        assertTrue(core.solanaCollateral(creditId));
        assertEq(core.remoteRecoveryVaultOf(creditId), core.solanaAlias(GENESIS, RECOVERY));
        assertEq(core.recoveryRefundRecipientOf(creditId), borrower);

        bytes32 lockId = keccak256("solana-lock");
        bytes32 lockPda = keccak256("solana-pda");
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.bindRemoteCollateral(creditId, lockId);
        vm.prank(borrower);
        core.bindSolanaCollateral(creditId, lockId, lockPda);
        assertEq(core.solanaLockPdaOf(creditId), lockPda);

        verifier.setExpectedLockDigest(core.solanaLockDigest(creditId));
        core.proveSolanaCollateral(creditId, hex"01", hex"02");
        assertTrue(core.collateralProven(creditId));
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(creditId, SOURCE_CHAIN, hex"01", hex"02");
    }

    function testLegacyQuoteCannotBypassSolanaIdentity() public {
        Types.SolanaQuote memory solana = _signedQuote();
        Types.Quote memory quote = solana.quote;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.acceptQuote(quote);
    }

    function testSolanaQuoteRejectsChangedSourceIdentity() public {
        Types.SolanaQuote memory solana = _signedQuote();
        solana.sourceOwner = keccak256("different-owner");
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.acceptSolanaQuote(solana);
    }

    function testDisabledMarketRejectsNewSolanaQuote() public {
        Types.SolanaQuote memory solana = _signedQuote();
        core.disableSolanaMarket(SOURCE_CHAIN);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.acceptSolanaQuote(solana);
    }

    function testStaleSalePriceRejectsNewSolanaQuote() public {
        Types.SolanaQuote memory solana = _signedQuote();
        oracle.setStale(true);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.acceptSolanaQuote(solana);
    }
}
