// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/monad/collateral/VerifierRegistry.sol";
import {Types} from "../../src/shared/Types.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";

contract MockSolanaProofVerifier {
    bytes32 public expectedLockDigest;
    bytes32 public expectedCancellationHash;
    uint256 public expectedCancellationNonce;

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

    function setExpectedCancellation(bytes32 actionHash, uint256 nonce) external {
        expectedCancellationHash = actionHash;
        expectedCancellationNonce = nonce;
    }

    function verifySolanaLock(bytes calldata, bytes calldata, bytes32, bytes32, bytes32, bytes32 digest)
        external
        view
        returns (bool)
    {
        return digest != bytes32(0) && digest == expectedLockDigest;
    }

    function verifySolanaAction(bytes calldata, bytes calldata, bytes32, bytes32, bytes32, bytes32, bytes32)
        external
        pure
        returns (bool)
    {
        return false;
    }

    function verifySolanaCancellation(
        bytes calldata header,
        bytes calldata proof,
        bytes32,
        bytes32,
        bytes32,
        bytes32,
        bytes32 actionHash,
        uint256 nonce,
        uint256
    ) external view returns (bool) {
        return header.length != 0 && proof.length != 0 && expectedCancellationHash != bytes32(0)
            && actionHash == expectedCancellationHash && nonce == expectedCancellationNonce;
    }
}

contract SolanaActionHashHarness is TermbookCore {
    constructor() TermbookCore(address(this), address(this), address(0)) {}

    function seed(bytes32 creditId) external {
        _credits[creditId].lockId = bytes32(uint256(0x0101010101010101010101010101010101010101010101010101010101010101));
        solanaCollateral[creditId] = true;
        solanaLockPdaOf[creditId] = bytes32(uint256(0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a));
        solanaIdentityOf[creditId] = SolanaIdentity({
            sourceGenesis: bytes32(uint256(0x0505050505050505050505050505050505050505050505050505050505050505)),
            programId: bytes32(uint256(0x0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b)),
            sourceAsset: bytes32(uint256(0x0101010101010101010101010101010101010101010101010101010101010101)),
            sourceOwner: bytes32(uint256(0x0404040404040404040404040404040404040404040404040404040404040404)),
            returnRecipient: bytes32(uint256(0x0606060606060606060606060606060606060606060606060606060606060606)),
            recoveryVault: bytes32(uint256(0xbdbed3ace275888feac5c50579ebede02206f95bd9f8925e53f0f3f4ec16a28b)),
            verifierVersion: 1
        });
    }

    function seedPendingReturn(
        bytes32 creditId,
        address registry,
        address verifier,
        uint256 sourceChain,
        bytes32 actionHash,
        uint256 deadline
    ) external {
        verifierRegistry = registry;
        _credits[creditId].verifierVersion = 1;
        _credits[creditId].verifierCodeHash = verifier.codehash;
        collateralSourceChainOf[creditId] = sourceChain;
        remoteCollateral[creditId] = true;
        remoteActionNonce[creditId] = 3;
        pendingRemoteReturn[creditId] = 1;
        remoteReturnActionHash[creditId] = actionHash;
        remoteReturnRevision[creditId] = 2;
        remoteReturnDeadline[creditId] = deadline;
    }
}

contract SolanaQuoteTest is Test {
    uint256 private constant SOURCE_CHAIN = 99;
    bytes32 private constant GENESIS = keccak256("solana-genesis");
    bytes32 private constant PROGRAM = keccak256("solana-program");
    bytes32 private constant PROGRAM_DATA_HASH = keccak256("solana-program-data");
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
        core.setSolanaMarket(SOURCE_CHAIN, GENESIS, PROGRAM, PROGRAM_DATA_HASH);
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
        assertEq(
            core.sourceRecoveryVault(SOURCE_CHAIN, solana.quote.collateralAsset),
            core.solanaAlias(GENESIS, PROGRAM)
        );
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

    function testSolanaQuoteRejectsRecoveryProgramAsCreditAccount() public {
        Types.SolanaQuote memory solana = _quote();
        solana.recoveryVault = PROGRAM;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.solanaQuoteDigest(solana));
        solana.quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.acceptSolanaQuote(solana);
    }

    function testSolanaActionHashMatchesSourceProgram() public {
        vm.chainId(143);
        SolanaActionHashHarness implementation = new SolanaActionHashHarness();
        address harnessAddress = address(uint160(0x0303030303030303030303030303030303030303));
        vm.etch(harnessAddress, address(implementation).code);
        SolanaActionHashHarness harness = SolanaActionHashHarness(harnessAddress);
        bytes32 creditId = bytes32(uint256(0x0202020202020202020202020202020202020202020202020202020202020202));
        harness.seed(creditId);
        assertEq(
            harness.solanaActionHash(creditId, 0, 500_000_000, 1, 2, 100),
            bytes32(uint256(0x1c59eb45703b3dd1375020a5568a87c6f7f687fcdd96a56dfc6d4f66c04616c8))
        );
    }

    function testSolanaRecoveryReturnHashMatchesSourceProgram() public {
        vm.chainId(143);
        SolanaActionHashHarness implementation = new SolanaActionHashHarness();
        address harnessAddress = address(uint160(0x0303030303030303030303030303030303030303));
        vm.etch(harnessAddress, address(implementation).code);
        SolanaActionHashHarness harness = SolanaActionHashHarness(harnessAddress);
        bytes32 creditId = bytes32(uint256(0x0202020202020202020202020202020202020202020202020202020202020202));
        harness.seed(creditId);
        assertEq(
            harness.solanaRecoveryReturnHash(creditId, 500_000_000, 1, 4, 100),
            bytes32(uint256(0x59b78f448854bb2eea58330ec822e6277cfa4a475fefbaa31395bae7c2ceca58))
        );
    }

    function testSolanaRecoveryFundHashMatchesSourceProgram() public {
        vm.chainId(143);
        SolanaActionHashHarness implementation = new SolanaActionHashHarness();
        address harnessAddress = address(uint160(0x0303030303030303030303030303030303030303));
        vm.etch(harnessAddress, address(implementation).code);
        SolanaActionHashHarness harness = SolanaActionHashHarness(harnessAddress);
        bytes32 creditId = bytes32(uint256(0x0202020202020202020202020202020202020202020202020202020202020202));
        harness.seed(creditId);
        TermbookCore.SolanaRecoveryFunding memory funding = TermbookCore.SolanaRecoveryFunding({
            creditId: creditId,
            operationId: bytes32(uint256(0x0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c)),
            inbox: address(bytes20(hex"0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e")),
            depositPubkey: bytes32(uint256(0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f)),
            amount: 500_000_000,
            quoteHash: bytes32(uint256(0x1010101010101010101010101010101010101010101010101010101010101010)),
            deadline: 100
        });
        assertEq(
            harness.solanaRecoveryFundHash(
                funding,
                bytes32(uint256(0x0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d)),
                1,
                4
            ),
            bytes32(uint256(0xe6a669e3cc25a4ef0e197c04252480c4e138da599fdf355db917b15c9a1bae08))
        );
    }

    function testExpiredSolanaReturnNeedsFinalizedCancellationProof() public {
        SolanaActionHashHarness harness = new SolanaActionHashHarness();
        VerifierRegistry sourceRegistry = new VerifierRegistry(address(this));
        MockSolanaProofVerifier sourceVerifier = new MockSolanaProofVerifier();
        sourceRegistry.setVerifier(SOURCE_CHAIN, address(sourceVerifier), 1, 1 days);
        bytes32 creditId = keccak256("cancelled-solana-return");
        bytes32 actionHash = keccak256("pending-action");
        uint256 deadline = block.timestamp + 1;
        harness.seed(creditId);
        harness.seedPendingReturn(creditId, address(sourceRegistry), address(sourceVerifier), SOURCE_CHAIN, actionHash, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        harness.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        sourceVerifier.setExpectedCancellation(actionHash, 3);
        harness.cancelExpiredRemoteReturn(creditId, hex"01", hex"02");
        assertEq(harness.pendingRemoteReturn(creditId), 0);
        assertEq(harness.remoteReturnRevision(creditId), 0);
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
