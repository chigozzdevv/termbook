// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MonadBftLightClient} from "../../src/ethereum/collateral/MonadBftLightClient.sol";
import {MonadVerifier} from "../../src/ethereum/collateral/MonadVerifier.sol";
import {MonadBftFixtures} from "./monad-bft-fixtures.sol";
import {MonadBftHeader} from "../../src/shared/collateral/MonadBftHeader.sol";

contract MonadBftHeaderHarness {
    function count(bytes calldata header) external pure returns (uint256) {
        return MonadBftHeader.executionCount(header);
    }

    function result(bytes calldata header, uint256 index) external pure returns (MonadBftHeader.Execution memory) {
        return MonadBftHeader.execution(header, index);
    }
}

contract MonadBftLightClientTest is Test {
    MonadBftLightClient private client;
    MonadVerifier private verifier;

    function setUp() public {
        vm.warp(1_800_000_010);
        uint256[] memory stakes = _stakes();
        client = new MonadBftLightClient(
            143, 1, 60, MonadBftFixtures.PARENT_ID, 100, 2,
            keccak256(abi.encode(MonadBftFixtures.KEYS, stakes))
        );
        verifier = new MonadVerifier(address(client));
    }

    function testFinalizesExecutionOnlyAfterTwoValidQuorumVotes() public {
        MonadBftHeaderHarness parser = new MonadBftHeaderHarness();
        assertEq(parser.count(MonadBftFixtures.BOOTSTRAP), 1);
        MonadBftHeader.Execution memory parsed = parser.result(MonadBftFixtures.BOOTSTRAP, 0);
        assertEq(parsed.number, 50);
        assertEq(client.bootstrapHash(), MonadBftFixtures.PARENT_ID);
        assertFalse(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP, MonadBftFixtures.CHILD,
            _proof(MonadBftFixtures.PARENT_SIGNATURE), _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        assertTrue(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
        assertEq(client.knownSequence(MonadBftFixtures.CHILD_ID), 101);
        assertEq(client.finalizedExecutionReceiptsRoot(MonadBftFixtures.EXECUTION), bytes32(uint256(type(uint256).max / 0xff * 0x33)));
        vm.warp(1_800_000_061);
        assertFalse(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
    }

    function testRejectsForgedChildAndInsufficientStake() public {
        bytes memory forged = MonadBftFixtures.CHILD;
        forged[forged.length - 1] ^= bytes1(uint8(1));
        vm.expectRevert();
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP, forged,
            _proof(MonadBftFixtures.PARENT_SIGNATURE), _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        MonadBftLightClient.QcProof memory weak = _proof(MonadBftFixtures.PARENT_SIGNATURE);
        weak.signerBits = hex"01";
        vm.expectRevert(MonadBftLightClient.Invalid.selector);
        client.submitFinalized(
            MonadBftFixtures.BOOTSTRAP, MonadBftFixtures.CHILD,
            weak, _proof(MonadBftFixtures.CHILD_SIGNATURE)
        );
        assertFalse(verifier.verifyFinality(MonadBftFixtures.EXECUTION));
    }

    function _proof(bytes memory signature) private pure returns (MonadBftLightClient.QcProof memory proof) {
        proof = MonadBftLightClient.QcProof(hex"03", MonadBftFixtures.KEYS, _stakes(), signature);
    }

    function _stakes() private pure returns (uint256[] memory stakes) {
        stakes = new uint256[](3);
        stakes[0] = 4;
        stakes[1] = 3;
        stakes[2] = 2;
    }
}
