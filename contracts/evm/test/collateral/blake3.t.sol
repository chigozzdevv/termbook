// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Blake3} from "../../src/shared/collateral/Blake3.sol";

contract Blake3Harness {
    function hash(bytes calldata input) external pure returns (bytes32) {
        return Blake3.hash(input);
    }
}

contract Blake3Test is Test {
    Blake3Harness private harness;

    function setUp() public {
        harness = new Blake3Harness();
    }

    function testOfficialHashVectorsAcrossChunkBoundaries() public view {
        _check(0, 0xaf1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262);
        _check(1, 0x2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213);
        _check(64, 0x4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98);
        _check(65, 0xde1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee);
        _check(1023, 0x10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11);
        _check(1024, 0x42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7);
        _check(1025, 0xd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444);
        _check(2048, 0xe776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a);
        _check(2049, 0x5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030);
        _check(4096, 0x015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969);
        _check(4097, 0x9b4052b38f1c5fc8b1f9ff7ac7b27cd242487b3d890d15c96a1c25b8aa0fb995);
    }

    function _check(uint256 length, bytes32 expected) private view {
        bytes memory input = new bytes(length);
        for (uint256 i; i < length; ++i) input[i] = bytes1(uint8(i % 251));
        assertEq(harness.hash(input), expected);
    }
}
