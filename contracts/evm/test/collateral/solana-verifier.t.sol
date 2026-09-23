// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockConsensusLightClient} from "./light-client-verifier.t.sol";
import {SolanaVerifier, ISolanaFinalizedAccountClient} from "../../src/monad/collateral/SolanaVerifier.sol";

contract MockSolanaAccountClient is MockConsensusLightClient, ISolanaFinalizedAccountClient {
    bytes32 public immutable sourceGenesis;
    bytes32 public immutable program;
    bytes32 public immutable programDataHash;
    bytes32 public accountOwner;
    uint64 public accountLamports;
    bytes public accountData;

    constructor(bytes32 genesis_, bytes32 program_, bytes32 programDataHash_)
        MockConsensusLightClient(99, 1, keccak256("solana-checkpoint"), 1 days)
    {
        sourceGenesis = genesis_;
        program = program_;
        programDataHash = programDataHash_;
        accountOwner = program_;
        accountLamports = 10_000;
    }

    function setRecord(bytes memory data) external {
        accountData = data;
    }

    function setOwner(bytes32 owner) external {
        accountOwner = owner;
    }

    function verifiedAccount(bytes calldata, bytes calldata proof, bytes32)
        external view returns (bytes32 owner, uint64 lamports, bytes memory data)
    {
        require(keccak256(proof) == keccak256(hex"01"), "account-proof");
        return (accountOwner, accountLamports, accountData);
    }

    function verifiedProgramDataHash(bytes calldata, bytes calldata proof, bytes32 program_)
        external view returns (bytes32)
    {
        require(program_ == program && keccak256(proof) == keccak256(hex"02"), "program-proof");
        return programDataHash;
    }
}

contract SolanaVerifierTest is Test {
    bytes32 private constant GENESIS = bytes32(uint256(0x0505050505050505050505050505050505050505050505050505050505050505));
    bytes32 private constant PROGRAM = bytes32(uint256(0x0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b));
    bytes32 private constant HASH = keccak256("solana-binary");
    bytes32 private constant VAULT = bytes32(uint256(0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a));
    bytes32 private constant ASSET = bytes32(uint256(0x0101010101010101010101010101010101010101010101010101010101010101));
    bytes32 private constant LOCK_ID = bytes32(uint256(0x0101010101010101010101010101010101010101010101010101010101010101));
    bytes32 private constant CREDIT_ID = bytes32(uint256(0x0202020202020202020202020202020202020202020202020202020202020202));
    bytes32 private constant OWNER = bytes32(uint256(0x0909090909090909090909090909090909090909090909090909090909090909));
    bytes32 private constant RETURN = bytes32(uint256(0x0606060606060606060606060606060606060606060606060606060606060606));
    bytes32 private constant RECOVERY = bytes32(uint256(0x0707070707070707070707070707070707070707070707070707070707070707));
    bytes32 private constant TERMS = bytes32(uint256(0x0808080808080808080808080808080808080808080808080808080808080808));
    bytes20 private constant CORE = bytes20(uint160(0x0303030303030303030303030303030303030303));
    bytes20 private constant BORROWER = bytes20(uint160(0x0404040404040404040404040404040404040404));

    MockSolanaAccountClient private client;
    SolanaVerifier private verifier;
    bytes private header;
    bytes private proof;

    function setUp() public {
        vm.warp(2 days);
        client = new MockSolanaAccountClient(GENESIS, PROGRAM, HASH);
        client.setResults(true, true);
        verifier = new SolanaVerifier(address(client), GENESIS, PROGRAM, HASH);
        header = abi.encode(block.timestamp, keccak256("finalized-state"));
        proof = abi.encode(VAULT, hex"01", hex"02");
        client.setRecord(_record());
    }

    function testAuthenticatesPinnedLockRecord() public {
        bytes32 digest = _lockDigest();
        assertTrue(verifier.verifySolanaLock(header, proof, GENESIS, PROGRAM, HASH, digest));
        assertFalse(verifier.verifySolanaLock(header, proof, GENESIS, PROGRAM, keccak256("other"), digest));
        assertFalse(verifier.verifySolanaLock(header, proof, GENESIS, PROGRAM, HASH, keccak256("other")));
        assertFalse(verifier.verifySolanaLock(header, abi.encode(keccak256("other-pda"), hex"01", hex"02"), GENESIS, PROGRAM, HASH, digest));
        client.setOwner(keccak256("attacker-program"));
        assertFalse(verifier.verifySolanaLock(header, proof, GENESIS, PROGRAM, HASH, digest));
    }

    function testVerifiesAppliedAndCanceledActionsFromDistinctFields() public {
        bytes32 applied = keccak256("applied");
        bytes memory record = _record();
        _setWord(record, 418, applied);
        _setU64(record, 402, 1);
        client.setRecord(record);
        assertTrue(verifier.verifySolanaAction(header, proof, GENESIS, PROGRAM, HASH, VAULT, applied));
        assertFalse(verifier.verifySolanaAction(header, proof, GENESIS, PROGRAM, HASH, VAULT, keccak256("forged")));

        bytes32 canceled = keccak256("canceled");
        _setU64(record, 402, 2);
        _setU64(record, 450, 2);
        _setWord(record, 458, canceled);
        client.setRecord(record);
        assertTrue(verifier.verifySolanaCancellation(header, proof, GENESIS, PROGRAM, HASH, VAULT, canceled, 2, block.timestamp - 1));
        assertFalse(verifier.verifySolanaCancellation(header, proof, GENESIS, PROGRAM, HASH, VAULT, canceled, 1, block.timestamp - 1));
        assertFalse(verifier.verifySolanaAction(header, proof, GENESIS, PROGRAM, HASH, VAULT, canceled));
    }

    function testRejectsStaleOrUnfinalizedHeader() public {
        assertFalse(verifier.verifySolanaLock(abi.encode(uint256(1), keccak256("old")), proof, GENESIS, PROGRAM, HASH, _lockDigest()));
        client.setResults(false, true);
        assertFalse(verifier.verifySolanaLock(header, proof, GENESIS, PROGRAM, HASH, _lockDigest()));
    }

    function testFundingProofAndPostDeadlineAbsenceUseRecoveryRecord() public {
        bytes32 fundingHash = keccak256("funded");
        bytes memory recoveryProof = abi.encode(RECOVERY, hex"01", hex"02");
        client.setRecord(_recoveryRecord(1, fundingHash));
        assertTrue(verifier.verifySolanaFunding(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID, fundingHash, 1
        ));
        assertFalse(verifier.verifySolanaFunding(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID, fundingHash, 2
        ));
        assertFalse(verifier.verifySolanaFundingAbsence(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID,
            fundingHash, 1, block.timestamp - 1
        ));
        client.setRecord(_recoveryRecord(0, bytes32(0)));
        assertTrue(verifier.verifySolanaFundingAbsence(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID,
            fundingHash, 1, block.timestamp - 1
        ));
        assertFalse(verifier.verifySolanaFundingAbsence(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID,
            fundingHash, 1, block.timestamp
        ));
    }

    function testPayoutProofAndPostDeadlineAbsenceUseRecoveryRecord() public {
        bytes32 payoutHash = keccak256("paid");
        bytes memory recoveryProof = abi.encode(RECOVERY, hex"01", hex"02");
        bytes memory record = _recoveryRecord(0, bytes32(0));
        _setU64(record, 170, 1);
        _setU64(record, 178, 4);
        _setWord(record, 186, payoutHash);
        client.setRecord(record);
        assertTrue(verifier.verifySolanaPayout(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID, payoutHash, 1
        ));
        assertFalse(verifier.verifySolanaPayoutAbsence(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID,
            payoutHash, 1, block.timestamp - 1
        ));
        client.setRecord(_recoveryRecord(0, bytes32(0)));
        assertTrue(verifier.verifySolanaPayoutAbsence(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID,
            payoutHash, 1, block.timestamp - 1
        ));
        assertFalse(verifier.verifySolanaPayoutAbsence(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID,
            payoutHash, 1, block.timestamp
        ));
    }

    function testRefundProofRequiresExactCumulativeSourceLedger() public {
        bytes memory recoveryProof = abi.encode(RECOVERY, hex"01", hex"02");
        bytes memory record = _recoveryRecord(1, keccak256("funded"));
        _setU64(record, 274, 200);
        client.setRecord(record);
        assertTrue(verifier.verifySolanaRefund(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID, 200
        ));
        assertFalse(verifier.verifySolanaRefund(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID, 201
        ));
        _setU64(record, 274, 501);
        client.setRecord(record);
        assertFalse(verifier.verifySolanaRefund(
            header, recoveryProof, GENESIS, PROGRAM, HASH, VAULT, RECOVERY, CREDIT_ID, 501
        ));
    }

    function _record() private pure returns (bytes memory) {
        return abi.encodePacked(
            bytes1(uint8(3)), bytes1(uint8(254)), LOCK_ID, CREDIT_ID, OWNER,
            _le(143), CORE, BORROWER, GENESIS, PROGRAM, VAULT, ASSET, RETURN, RECOVERY, TERMS,
            _le(1_000), _le(1_000), _le(3 days), _le(1),
            _le(0), _le(0), bytes32(0), _le(0), bytes32(0)
        );
    }

    function _lockDigest() private pure returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("Termbook Solana lock v1"), CREDIT_ID, LOCK_ID, GENESIS, PROGRAM,
            VAULT, ASSET, OWNER, address(uint160(BORROWER)), RETURN, RECOVERY,
            uint256(143), address(uint160(CORE)), uint256(1_000), uint256(3 days), TERMS, uint256(1)
        ));
    }

    function _recoveryRecord(uint64 fundingNonce, bytes32 fundingHash) private pure returns (bytes memory) {
        return abi.encodePacked(
            bytes1(uint8(3)), bytes1(uint8(254)), CREDIT_ID, LOCK_ID, OWNER, VAULT,
            _le(500), keccak256("seized"), _le(0), _le(0), bytes32(0),
            _le(fundingNonce == 0 ? 0 : 500), _le(fundingNonce),
            _le(fundingNonce == 0 ? 0 : 4), fundingHash, _le(0)
        );
    }

    function _le(uint64 value) private pure returns (bytes8 result) {
        for (uint256 i; i < 8; ++i) result |= bytes8(uint64(uint8(value >> uint64(8 * i))) << uint64(56 - 8 * i));
    }

    function _setWord(bytes memory data, uint256 offset, bytes32 value) private pure {
        for (uint256 i; i < 32; ++i) data[offset + i] = value[i];
    }

    function _setU64(bytes memory data, uint256 offset, uint64 value) private pure {
        for (uint256 i; i < 8; ++i) data[offset + i] = bytes1(uint8(value >> (8 * i)));
    }
}
