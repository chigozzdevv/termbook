// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MonadBftVote} from "../../src/shared/collateral/MonadBftVote.sol";

contract MonadBftVoteHarness {
    function verify(
        bytes32 blockId,
        uint64 round,
        uint64 epoch,
        bytes32 validatorSetHash,
        bytes calldata bits,
        bytes calldata keys,
        uint256[] calldata stakes,
        bytes calldata signature
    ) external view returns (bool) {
        return MonadBftVote.verify(blockId, round, epoch, validatorSetHash, bits, keys, stakes, signature);
    }

    function message(bytes32 blockId, uint64 round, uint64 epoch) external pure returns (bytes memory) {
        return MonadBftVote.voteMessage(blockId, round, epoch);
    }
}

contract MonadBftVoteTest is Test {
    bytes32 private constant BLOCK_ID = bytes32(uint256(type(uint256).max / 0xff * 0x11));
    bytes private constant KEY_1 = hex"0000000000000000000000000000000017f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"
        hex"0000000000000000000000000000000008b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1";
    bytes private constant KEY_2 = hex"000000000000000000000000000000000572cbea904d67468808c8eb50a9450c9721db309128012543902d0ac358a62ae28f75bb8f1c7c42c39a8c5529bf0f4e"
        hex"00000000000000000000000000000000166a9d8cabc673a322fda673779d8e3822ba3ecb8670e461f73bb9021d5fd76a4c56d9d4cd16bd1bba86881979749d28";
    bytes private constant KEY_3 = hex"0000000000000000000000000000000009ece308f9d1f0131765212deca99697b112d61f9be9a5f1f3780a51335b3ff981747a0b2ca2179b96d2c0c9024e5224"
        hex"00000000000000000000000000000000032b80d3a6f5b09f8a84623389c5f80ca69a0cddabc3097f9d9c27310fd43be6e745256c634af45ca3473b0590ae30d1";
    bytes private constant SIGNATURE = hex"00000000000000000000000000000000020b915ebb6815b5a1a49f0f302109dc7725a1745fd4bbd314f8e97e453b5e3973459b18a5c2eaab4d8db3328fd934fd"
        hex"000000000000000000000000000000000b49ba0ff5ffb5013c7c32236eea61cb535af310c05f88aa4907fc02bf45779c930b192a98cd04b51a97b1163f662867"
        hex"0000000000000000000000000000000009bdc46fefdbddb9c41c5a083e8671b1e5eda6b6cab8bb39c826b025c642c1e58d75b5783059057f7403ed39529ec491"
        hex"0000000000000000000000000000000014487fadcc8c1e23f1f4e09d19e601f6163fa84a72e45e3891fe3e3f20ffcc2fa79a34e3e61cc793b3dde062684f6106";

    MonadBftVoteHarness private harness;

    function setUp() public {
        harness = new MonadBftVoteHarness();
    }

    function testVerifiesNativeVoteWithStakeWeightedQuorum() public view {
        bytes memory keys = bytes.concat(KEY_1, KEY_2, KEY_3);
        uint256[] memory stakes = _stakes();
        bytes32 validatorSetHash = keccak256(abi.encode(keys, stakes));
        assertEq(
            harness.message(BLOCK_ID, 129, 2),
            hex"0d6d6f6e61642f766f74652f310ae4a01111111111111111111111111111111111111111111111111111111111111111818102"
        );
        assertTrue(harness.verify(BLOCK_ID, 129, 2, validatorSetHash, hex"03", keys, stakes, SIGNATURE));
        assertFalse(harness.verify(BLOCK_ID, 130, 2, validatorSetHash, hex"03", keys, stakes, SIGNATURE));
        assertFalse(harness.verify(BLOCK_ID, 129, 3, validatorSetHash, hex"03", keys, stakes, SIGNATURE));
        assertFalse(harness.verify(BLOCK_ID, 129, 2, validatorSetHash, hex"01", keys, stakes, SIGNATURE));
        assertFalse(harness.verify(BLOCK_ID, 129, 2, validatorSetHash, hex"83", keys, stakes, SIGNATURE));
        stakes[0] = 5;
        assertFalse(harness.verify(BLOCK_ID, 129, 2, validatorSetHash, hex"03", keys, stakes, SIGNATURE));
    }

    function _stakes() private pure returns (uint256[] memory stakes) {
        stakes = new uint256[](3);
        stakes[0] = 4;
        stakes[1] = 3;
        stakes[2] = 2;
    }
}
