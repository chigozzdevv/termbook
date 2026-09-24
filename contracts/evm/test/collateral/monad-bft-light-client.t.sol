// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MonadBftLightClient} from "../../src/ethereum/collateral/MonadBftLightClient.sol";
import {MonadVerifier} from "../../src/ethereum/collateral/MonadVerifier.sol";
import {MonadBftFixtures} from "./monad-bft-fixtures.sol";
import {MonadBftHeader} from "../../src/shared/collateral/MonadBftHeader.sol";
import {EvmReceiptProof} from "../../src/shared/collateral/EvmReceiptProof.sol";

contract MonadBftHeaderHarness {
    function count(bytes calldata header) external pure returns (uint256) {
        return MonadBftHeader.executionCount(header);
    }

    function result(bytes calldata header, uint256 index) external pure returns (MonadBftHeader.Execution memory) {
        return MonadBftHeader.execution(header, index);
    }
}

contract ValidatorSetReceiptHarness {
    function verify(bytes32 root, bytes calldata proof, address emitter, uint64 epoch, bytes32 setHash)
        external
        pure
        returns (bool)
    {
        return EvmReceiptProof.verifyValidatorSet(root, proof, emitter, epoch, setHash);
    }
}

contract MonadBftLightClientTest is Test {
    MonadBftLightClient private client;
    MonadVerifier private verifier;

    function setUp() public {
        vm.warp(1_800_000_010);
        uint256[] memory stakes = _stakes();
        client = new MonadBftLightClient(
            143,
            1,
            60,
            MonadBftFixtures.PARENT_ID,
            100,
            2,
            keccak256(abi.encode(MonadBftFixtures.COMPRESSED_KEYS, stakes)),
            address(0x1234)
        );
        verifier = new MonadVerifier(address(client));
        assertLt(address(client).code.length, 24_577);
    }

    function testFinalizesExecutionOnlyAfterTwoValidQuorumVotes() public {
        MonadBftHeaderHarness parser = new MonadBftHeaderHarness();
        assertEq(parser.count(MonadBftFixtures.BOOTSTRAP), 1);
        MonadBftHeader.Execution memory parsed = parser.result(MonadBftFixtures.BOOTSTRAP, 0);
        assertEq(parsed.number, 50);
        assertEq(client.bootstrapHash(), MonadBftFixtures.PARENT_ID);
        assertFalse(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP,
            MonadBftFixtures.CHILD,
            _proof(MonadBftFixtures.PARENT_SIGNATURE),
            _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        assertTrue(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
        assertEq(client.knownSequence(MonadBftFixtures.CHILD_ID), 101);
        assertEq(client.finalizedExecutionReceiptsRoot(MonadBftFixtures.EXECUTION), MonadBftFixtures.RECEIPTS_ROOT);
        vm.warp(1_800_000_061);
        assertFalse(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
    }

    function testRejectsForgedChildAndInsufficientStake() public {
        bytes memory forged = MonadBftFixtures.CHILD;
        forged[forged.length - 1] ^= bytes1(uint8(1));
        vm.expectRevert();
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP,
            forged,
            _proof(MonadBftFixtures.PARENT_SIGNATURE),
            _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        MonadBftLightClient.QcProof memory weak = _proof(MonadBftFixtures.PARENT_SIGNATURE);
        weak.signerBits = hex"01";
        vm.expectRevert(MonadBftLightClient.Invalid.selector);
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP, MonadBftFixtures.CHILD, weak, _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        assertFalse(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
    }

    function testLearnsNextEpochFromFinalizedCommitment() public {
        uint256[] memory stakes = _stakes();
        assertEq(MonadBftFixtures.SET_HASH, keccak256(abi.encode(MonadBftFixtures.COMPRESSED_KEYS, stakes)));
        bytes memory receiptProof = _receiptProof();
        vm.expectRevert(MonadBftLightClient.Invalid.selector);
        client.submitValidatorSet(3, MonadBftFixtures.SET_HASH, MonadBftFixtures.EXECUTION, receiptProof);
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP,
            MonadBftFixtures.CHILD,
            _proof(MonadBftFixtures.PARENT_SIGNATURE),
            _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        vm.expectRevert(MonadBftLightClient.Invalid.selector);
        client.submitValidatorSet(3, keccak256("wrong"), MonadBftFixtures.EXECUTION, receiptProof);
        client.submitValidatorSet(3, MonadBftFixtures.SET_HASH, MonadBftFixtures.EXECUTION, receiptProof);
        assertEq(client.validatorSetHashOfEpoch(3), MonadBftFixtures.SET_HASH);
        client.submitFinalized(
            MonadBftFixtures.CHILD,
            MonadBftFixtures.NEXT_EPOCH_CHILD,
            _proof(MonadBftFixtures.CHILD_SIGNATURE),
            _proof(MonadBftFixtures.NEXT_EPOCH_SIGNATURE)
        );
        assertTrue(client.finalizedConsensus(MonadBftFixtures.CHILD_ID));
        assertEq(client.knownSequence(MonadBftFixtures.NEXT_EPOCH_CHILD_ID), 102);
    }

    function testValidatorReceiptBindsEmitterEpochAndSetHash() public {
        ValidatorSetReceiptHarness harness = new ValidatorSetReceiptHarness();
        bytes memory proof = _receiptProof();
        assertTrue(harness.verify(MonadBftFixtures.RECEIPTS_ROOT, proof, address(0x1234), 3, MonadBftFixtures.SET_HASH));
        assertFalse(
            harness.verify(MonadBftFixtures.RECEIPTS_ROOT, proof, address(0x4321), 3, MonadBftFixtures.SET_HASH)
        );
        assertFalse(
            harness.verify(MonadBftFixtures.RECEIPTS_ROOT, proof, address(0x1234), 4, MonadBftFixtures.SET_HASH)
        );
        assertFalse(harness.verify(MonadBftFixtures.RECEIPTS_ROOT, proof, address(0x1234), 3, keccak256("wrong")));
    }

    function testCanAdvancePastSkippedRoundWithoutFinalizingIt() public {
        client.submitCertified(
            MonadBftFixtures.BOOTSTRAP,
            MonadBftFixtures.GAP_CHILD,
            _proof(MonadBftFixtures.PARENT_SIGNATURE),
            _proof(MonadBftFixtures.GAP_SIGNATURE)
        );
        assertFalse(client.finalizedConsensus(MonadBftFixtures.PARENT_ID));
        assertEq(client.knownSequence(MonadBftFixtures.GAP_ID), 101);
        client.submitFinalized(
            MonadBftFixtures.GAP_CHILD,
            MonadBftFixtures.GAP_GRANDCHILD,
            _proof(MonadBftFixtures.GAP_SIGNATURE),
            _proof(MonadBftFixtures.GAP_GRANDCHILD_SIGNATURE)
        );
        assertTrue(client.finalizedConsensus(MonadBftFixtures.GAP_ID));
    }

    function testCanCertifyAfterTheParentWasFinalized() public {
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP,
            MonadBftFixtures.CHILD,
            _proof(MonadBftFixtures.PARENT_SIGNATURE),
            _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        client.submitCertified(
            MonadBftFixtures.BOOTSTRAP,
            MonadBftFixtures.GAP_CHILD,
            _proof(MonadBftFixtures.PARENT_SIGNATURE),
            _proof(MonadBftFixtures.GAP_SIGNATURE)
        );
        client.submitFinalized(
            MonadBftFixtures.GAP_CHILD,
            MonadBftFixtures.GAP_GRANDCHILD,
            _proof(MonadBftFixtures.GAP_SIGNATURE),
            _proof(MonadBftFixtures.GAP_GRANDCHILD_SIGNATURE)
        );
        assertTrue(client.finalizedConsensus(MonadBftFixtures.GAP_ID));
    }

    function _receiptProof() private pure returns (bytes memory proof) {
        bytes[] memory nodes = new bytes[](1);
        nodes[0] = MonadBftFixtures.RECEIPT_LEAF;
        return abi.encode(uint256(0), uint256(0), nodes);
    }

    function _proof(bytes memory signature) private pure returns (MonadBftLightClient.QcProof memory proof) {
        proof = MonadBftLightClient.QcProof(
            hex"03", MonadBftFixtures.COMPRESSED_KEYS, MonadBftFixtures.KEYS, _stakes(), signature
        );
    }

    function _stakes() private pure returns (uint256[] memory stakes) {
        stakes = new uint256[](3);
        stakes[0] = 4;
        stakes[1] = 3;
        stakes[2] = 2;
    }
}
