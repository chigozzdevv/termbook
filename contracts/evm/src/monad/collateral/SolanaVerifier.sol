// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LightClientVerifier} from "../../shared/collateral/LightClientVerifier.sol";
import {IConsensusLightClient} from "../../shared/collateral/IVerifier.sol";

interface ISolanaFinalizedAccountClient {
    function sourceGenesis() external view returns (bytes32);
    function verifiedAccount(bytes calldata header, bytes calldata proof, bytes32 account)
        external view returns (bytes32 owner, uint64 lamports, bytes memory data);
    function verifiedProgramDataHash(bytes calldata header, bytes calldata proof, bytes32 program)
        external view returns (bytes32);
}

contract SolanaVerifier is LightClientVerifier {
    uint256 internal constant LOCK_RECORD_SIZE = 490;
    uint256 internal constant RECOVERY_RECORD_SIZE = 282;
    uint256 internal constant MAX_PROOF_SIZE = 96_000;
    bytes32 internal constant LOCK_DOMAIN = keccak256("Termbook Solana lock v1");
    bytes32 internal constant NATIVE_SOL_ASSET_ID = 0x0101010101010101010101010101010101010101010101010101010101010101;

    bytes32 public immutable sourceGenesis;
    bytes32 public immutable sourceProgram;
    bytes32 public immutable sourceProgramDataHash;

    error InvalidSolanaProof();

    constructor(address lightClient_, bytes32 sourceGenesis_, bytes32 sourceProgram_, bytes32 sourceProgramDataHash_)
        LightClientVerifier(lightClient_)
    {
        if (
            sourceGenesis_ == bytes32(0) || sourceProgram_ == bytes32(0)
                || sourceProgramDataHash_ == bytes32(0)
                || ISolanaFinalizedAccountClient(lightClient_).sourceGenesis() != sourceGenesis_
        ) revert InvalidLightClient();
        sourceGenesis = sourceGenesis_;
        sourceProgram = sourceProgram_;
        sourceProgramDataHash = sourceProgramDataHash_;
    }

    function verifyLock(bytes calldata, bytes calldata, address, bytes32) external pure override returns (bool) {
        return false;
    }

    function verifyEvent(bytes calldata, bytes calldata, address, bytes32)
        external pure override returns (bool)
    {
        return false;
    }

    function verifySolanaLock(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockDigest
    ) external view returns (bool) {
        if (!_market(genesis, program, programDataHash) || lockDigest == bytes32(0)) return false;
        try this.verifiedLockRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return _validRecord(account, lamports, data)
                && _u64(data, 378) == _u64(data, 370)
                && _u64(data, 402) == 0
                && _lockDigest(data) == lockDigest;
        } catch {
            return false;
        }
    }

    function verifySolanaAction(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockPda,
        bytes32 actionDigest
    ) external view returns (bool) {
        if (!_market(genesis, program, programDataHash) || lockPda == bytes32(0) || actionDigest == bytes32(0)) {
            return false;
        }
        try this.verifiedLockRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return account == lockPda && _validRecord(account, lamports, data)
                && _word(data, 418) == actionDigest && _word(data, 458) != actionDigest;
        } catch {
            return false;
        }
    }

    function verifySolanaCancellation(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockPda,
        bytes32 actionHash,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bool) {
        if (
            !_market(genesis, program, programDataHash) || lockPda == bytes32(0) || actionHash == bytes32(0)
                || nonce == 0 || nonce > type(uint64).max || deadline == 0
        ) return false;
        try this.verifiedLockRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return account == lockPda && _validRecord(account, lamports, data)
                && _u64(data, 402) == nonce && _u64(data, 450) == nonce
                && _word(data, 458) == actionHash && _word(data, 418) != actionHash;
        } catch {
            return false;
        }
    }

    function verifySolanaFunding(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockPda,
        bytes32 recoveryPda,
        bytes32 creditId,
        bytes32 actionHash,
        uint256 nonce
    ) external view returns (bool) {
        if (!_market(genesis, program, programDataHash) || actionHash == bytes32(0)
            || nonce == 0 || nonce > type(uint64).max) return false;
        try this.verifiedRecoveryRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return account == recoveryPda && _validRecovery(account, lamports, data, creditId, lockPda)
                && _u64(data, 226) == nonce && _word(data, 242) == actionHash;
        } catch {
            return false;
        }
    }

    function verifySolanaFundingAbsence(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockPda,
        bytes32 recoveryPda,
        bytes32 creditId,
        bytes32 actionHash,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bool) {
        if (!_market(genesis, program, programDataHash) || actionHash == bytes32(0)
            || nonce == 0 || nonce > type(uint64).max || deadline == 0) return false;
        try this.verifiedRecoveryRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return account == recoveryPda && _validRecovery(account, lamports, data, creditId, lockPda)
                && _u64(data, 226) < nonce && _word(data, 242) != actionHash
                && IConsensusLightClient(lightClient).headerTimestamp(header) > deadline;
        } catch {
            return false;
        }
    }

    function verifySolanaPayout(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockPda,
        bytes32 recoveryPda,
        bytes32 creditId,
        bytes32 actionHash,
        uint256 nonce
    ) external view returns (bool) {
        if (!_market(genesis, program, programDataHash) || actionHash == bytes32(0)
            || nonce == 0 || nonce > type(uint64).max) return false;
        try this.verifiedRecoveryRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return account == recoveryPda && _validRecovery(account, lamports, data, creditId, lockPda)
                && _u64(data, 170) == nonce && _word(data, 186) == actionHash;
        } catch {
            return false;
        }
    }

    function verifySolanaPayoutAbsence(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockPda,
        bytes32 recoveryPda,
        bytes32 creditId,
        bytes32 actionHash,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bool) {
        if (!_market(genesis, program, programDataHash) || actionHash == bytes32(0)
            || nonce == 0 || nonce > type(uint64).max || deadline == 0) return false;
        try this.verifiedRecoveryRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return account == recoveryPda && _validRecovery(account, lamports, data, creditId, lockPda)
                && _u64(data, 170) < nonce && _word(data, 186) != actionHash
                && IConsensusLightClient(lightClient).headerTimestamp(header) > deadline;
        } catch {
            return false;
        }
    }

    function verifySolanaRefund(
        bytes calldata header,
        bytes calldata proof,
        bytes32 genesis,
        bytes32 program,
        bytes32 programDataHash,
        bytes32 lockPda,
        bytes32 recoveryPda,
        bytes32 creditId,
        uint256 cumulativeRefunded
    ) external view returns (bool) {
        if (
            !_market(genesis, program, programDataHash) || cumulativeRefunded == 0
                || cumulativeRefunded > type(uint64).max
        ) return false;
        try this.verifiedRecoveryRecord(header, proof) returns (bytes32 account, uint64 lamports, bytes memory data) {
            return account == recoveryPda && _validRecovery(account, lamports, data, creditId, lockPda)
                && _u64(data, 274) == cumulativeRefunded && _u64(data, 218) >= cumulativeRefunded;
        } catch {
            return false;
        }
    }

    function verifiedLockRecord(bytes calldata header, bytes calldata proof)
        external view returns (bytes32 account, uint64 lamports, bytes memory data)
    {
        if (msg.sender != address(this)) revert InvalidSolanaProof();
        return _verifiedAccount(header, proof);
    }

    function verifiedRecoveryRecord(bytes calldata header, bytes calldata proof)
        external view returns (bytes32 account, uint64 lamports, bytes memory data)
    {
        if (msg.sender != address(this)) revert InvalidSolanaProof();
        return _verifiedAccount(header, proof);
    }

    function _verifiedAccount(bytes calldata header, bytes calldata proof)
        internal view returns (bytes32 account, uint64 lamports, bytes memory data)
    {
        if (proof.length == 0 || proof.length > MAX_PROOF_SIZE || !this.verifyFinality(header)) {
            revert InvalidSolanaProof();
        }
        bytes memory accountProof;
        bytes memory programProof;
        (account, accountProof, programProof) = abi.decode(proof, (bytes32, bytes, bytes));
        if (account == bytes32(0) || accountProof.length == 0 || programProof.length == 0) {
            revert InvalidSolanaProof();
        }
        ISolanaFinalizedAccountClient client = ISolanaFinalizedAccountClient(lightClient);
        if (client.verifiedProgramDataHash(header, programProof, sourceProgram) != sourceProgramDataHash) {
            revert InvalidSolanaProof();
        }
        bytes32 owner;
        (owner, lamports, data) = client.verifiedAccount(header, accountProof, account);
        if (owner != sourceProgram) revert InvalidSolanaProof();
    }

    function _market(bytes32 genesis, bytes32 program, bytes32 programDataHash) internal view returns (bool) {
        return genesis == sourceGenesis && program == sourceProgram && programDataHash == sourceProgramDataHash;
    }

    function _validRecord(bytes32 account, uint64 lamports, bytes memory data) internal view returns (bool) {
        return data.length == LOCK_RECORD_SIZE && uint8(data[0]) == 3
            && _word(data, 146) == sourceGenesis && _word(data, 178) == sourceProgram
            && _word(data, 210) == account && _word(data, 242) == NATIVE_SOL_ASSET_ID
            && _word(data, 2) != bytes32(0) && _word(data, 34) != bytes32(0)
            && _word(data, 66) != bytes32(0) && _word(data, 274) != bytes32(0)
            && _word(data, 306) != bytes32(0) && _word(data, 338) != bytes32(0)
            && _u64(data, 98) != 0 && _u64(data, 370) != 0
            && _u64(data, 378) <= _u64(data, 370) && lamports >= _u64(data, 378);
    }

    function _validRecovery(bytes32 account, uint64 lamports, bytes memory data, bytes32 creditId, bytes32 lockPda)
        internal pure returns (bool)
    {
        return account != bytes32(0) && creditId != bytes32(0) && lockPda != bytes32(0)
            && data.length == RECOVERY_RECORD_SIZE && uint8(data[0]) == 3
            && _word(data, 2) == creditId && _word(data, 34) != bytes32(0)
            && _word(data, 66) != bytes32(0) && _word(data, 98) == lockPda
            && lamports >= _u64(data, 130);
    }

    function _lockDigest(bytes memory data) internal pure returns (bytes32) {
        bytes32[17] memory words;
        words[0] = LOCK_DOMAIN;
        words[1] = _word(data, 34);
        words[2] = _word(data, 2);
        words[3] = _word(data, 146);
        words[4] = _word(data, 178);
        words[5] = _word(data, 210);
        words[6] = _word(data, 242);
        words[7] = _word(data, 66);
        words[8] = bytes32(uint256(uint160(_address(data, 126))));
        words[9] = _word(data, 274);
        words[10] = _word(data, 306);
        words[11] = bytes32(uint256(_u64(data, 98)));
        words[12] = bytes32(uint256(uint160(_address(data, 106))));
        words[13] = bytes32(uint256(_u64(data, 370)));
        words[14] = bytes32(uint256(_u64(data, 386)));
        words[15] = _word(data, 338);
        words[16] = bytes32(uint256(_u64(data, 394)));
        return keccak256(abi.encode(words));
    }

    function _word(bytes memory data, uint256 offset) internal pure returns (bytes32 result) {
        assembly ("memory-safe") {
            result := mload(add(add(data, 0x20), offset))
        }
    }

    function _address(bytes memory data, uint256 offset) internal pure returns (address) {
        return address(uint160(uint256(_word(data, offset)) >> 96));
    }

    function _u64(bytes memory data, uint256 offset) internal pure returns (uint64 result) {
        for (uint256 i; i < 8; ++i) result |= uint64(uint8(data[offset + i])) << uint64(8 * i);
    }
}
