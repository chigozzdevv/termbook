// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MonadEpochCommitter} from "../../src/monad/collateral/MonadEpochCommitter.sol";
import {MonadBftFixtures} from "./monad-bft-fixtures.sol";

contract StakingEpochFixture {
    bool public immutable delay;
    bool public immutable duplicate;
    uint32 public immutable size;

    constructor(bool delay_, bool duplicate_, uint32 size_) {
        delay = delay_;
        duplicate = duplicate_;
        size = size_;
    }

    function getEpoch() external view returns (uint64, bool) {
        return (2, delay);
    }

    function getConsensusValidatorSet(uint32 cursor) external view returns (bool, uint32, uint64[] memory ids) {
        if (cursor >= size) revert();
        uint32 count = size - cursor > 100 ? 100 : size - cursor;
        ids = new uint64[](count);
        for (uint32 i; i < count; ++i) {
            ids[i] = uint64(cursor + i + 1);
        }
        return (cursor + count == size, cursor + count, ids);
    }

    function getValidator(uint64 id)
        external
        view
        returns (
            address,
            uint64,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            bytes memory,
            bytes memory key
        )
    {
        if (id == 0 || id > size) revert();
        key = new bytes(48);
        if (size == 3) {
            bytes memory compressed = MonadBftFixtures.COMPRESSED_KEYS;
            uint256 index = duplicate && id == 2 ? 0 : id - 1;
            for (uint256 i; i < 48; ++i) {
                key[i] = compressed[index * 48 + i];
            }
        } else {
            key[0] = bytes1(0x80);
            key[46] = bytes1(uint8(id >> 8));
            key[47] = bytes1(uint8(id));
        }
        return (address(1), 0, 0, 0, 0, 0, size == 3 ? id == 1 ? 4 : id == 2 ? 3 : 2 : 1, 0, 0, 0, "", key);
    }
}

contract MonadEpochCommitterTest is Test {
    event ValidatorSetCommitted(uint64 indexed epoch, bytes32 indexed validatorSetHash);

    function testCommitsTheBoundaryConsensusSetOnce() public {
        StakingEpochFixture staking = new StakingEpochFixture(true, false, 3);
        vm.etch(address(0x1000), address(staking).code);
        MonadEpochCommitter committer = new MonadEpochCommitter();
        uint256[] memory stakes = new uint256[](3);
        stakes[0] = 4;
        stakes[1] = 3;
        stakes[2] = 2;
        bytes32 expected = keccak256(abi.encode(MonadBftFixtures.COMPRESSED_KEYS, stakes));
        vm.expectEmit(true, true, false, false);
        emit ValidatorSetCommitted(3, expected);
        assertEq(committer.commitNextEpoch(), expected);
        assertEq(committer.validatorSetHash(3), expected);
        vm.expectRevert(MonadEpochCommitter.Invalid.selector);
        committer.commitNextEpoch();
    }

    function testRejectsOutsideBoundary() public {
        StakingEpochFixture staking = new StakingEpochFixture(false, false, 3);
        vm.etch(address(0x1000), address(staking).code);
        MonadEpochCommitter committer = new MonadEpochCommitter();
        vm.expectRevert(MonadEpochCommitter.Invalid.selector);
        committer.commitNextEpoch();
    }

    function testRejectsDuplicateValidatorKey() public {
        StakingEpochFixture staking = new StakingEpochFixture(true, true, 3);
        vm.etch(address(0x1000), address(staking).code);
        MonadEpochCommitter committer = new MonadEpochCommitter();
        vm.expectRevert(MonadEpochCommitter.Invalid.selector);
        committer.commitNextEpoch();
    }

    function testFullValidatorSetFitsWithinMonadTransactionGas() public {
        StakingEpochFixture staking = new StakingEpochFixture(true, false, 200);
        vm.etch(address(0x1000), address(staking).code);
        MonadEpochCommitter committer = new MonadEpochCommitter();
        uint256 beforeGas = gasleft();
        committer.commitNextEpoch();
        uint256 usedGas = beforeGas - gasleft();
        assertLt(usedGas + 200 * 97_200 + 2 * 814_000, 30_000_000);
    }
}
