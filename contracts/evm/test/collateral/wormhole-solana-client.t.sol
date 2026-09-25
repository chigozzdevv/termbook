// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IWormholeCore} from "../../src/shared/collateral/IWormholeCore.sol";
import {WormholeSolanaAccountClient} from "../../src/monad/collateral/WormholeSolanaAccountClient.sol";

contract MockWormholeCore is IWormholeCore {
    VM internal message;
    bool internal valid = true;

    function chainId() external pure returns (uint16) { return 48; }
    function messageFee() external pure returns (uint256) { return 0; }
    function publishMessage(uint32, bytes memory, uint8) external payable returns (uint64) { return 1; }
    function parseAndVerifyVM(bytes calldata) external view returns (VM memory, bool, string memory) {
        return (message, valid, "");
    }
    function setMessage(VM memory value, bool ok) external {
        message = value;
        valid = ok;
    }
}

contract WormholeSolanaAccountClientTest is Test {
    bytes32 private constant GENESIS = keccak256("genesis");
    bytes32 private constant PROGRAM = keccak256("program");
    bytes32 private constant EMITTER = keccak256("emitter");
    bytes32 private constant PROGRAM_HASH = keccak256("program-data");
    bytes32 private constant ACCOUNT = keccak256("account");
    MockWormholeCore private core;
    WormholeSolanaAccountClient private client;

    function setUp() public {
        vm.warp(2 days);
        core = new MockWormholeCore();
        client = new WormholeSolanaAccountClient(
            address(core), 101, 1, GENESIS, PROGRAM, EMITTER, PROGRAM_HASH, 1 hours
        );
        core.setMessage(_message(_snapshot(ACCOUNT, 1_000, hex"010203")), true);
    }

    function testAcceptsOnlyPinnedFinalizedSnapshot() public {
        (bytes32 owner, uint64 lamports, bytes memory data) = client.verifiedAccount(hex"01", hex"01", ACCOUNT);
        assertEq(owner, PROGRAM);
        assertEq(lamports, 1_000);
        assertEq(data, hex"010203");
        assertEq(client.verifiedProgramDataHash(hex"01", hex"02", PROGRAM), PROGRAM_HASH);
        assertTrue(client.verifyFinality(hex"01"));
    }

    function testRejectsOtherEmitterAndUnfinalizedMessage() public {
        IWormholeCore.VM memory message = _message(_snapshot(ACCOUNT, 1_000, hex"010203"));
        message.emitterAddress = keccak256("other");
        core.setMessage(message, true);
        assertFalse(client.verifyFinality(hex"01"));
        vm.expectRevert(WormholeSolanaAccountClient.InvalidWormholeMessage.selector);
        client.verifiedAccount(hex"01", hex"01", ACCOUNT);
        message.emitterAddress = EMITTER;
        message.consistencyLevel = 32;
        core.setMessage(message, true);
        assertFalse(client.verifyFinality(hex"01"));
    }

    function testRejectsMalformedAndStaleSnapshots() public {
        IWormholeCore.VM memory message = _message(hex"01");
        core.setMessage(message, true);
        vm.expectRevert(WormholeSolanaAccountClient.InvalidWormholeMessage.selector);
        client.verifiedAccount(hex"01", hex"01", ACCOUNT);
        message = _message(_snapshot(ACCOUNT, 1_000, hex"010203"));
        message.timestamp = 1;
        core.setMessage(message, true);
        assertFalse(client.verifyFinality(hex"01"));
        message.timestamp = uint32(block.timestamp);
        core.setMessage(message, false);
        assertFalse(client.verifyFinality(hex"01"));
    }

    function testRejectsAccountSubstitution() public {
        vm.expectRevert(WormholeSolanaAccountClient.InvalidWormholeMessage.selector);
        client.verifiedAccount(hex"01", hex"01", keccak256("other-account"));
        vm.expectRevert(WormholeSolanaAccountClient.InvalidWormholeMessage.selector);
        client.verifiedProgramDataHash(hex"01", hex"02", keccak256("other-program"));
    }

    function _message(bytes memory payload) private view returns (IWormholeCore.VM memory message) {
        message.version = 1;
        message.timestamp = uint32(block.timestamp);
        message.emitterChainId = 1;
        message.emitterAddress = EMITTER;
        message.consistencyLevel = 1;
        message.payload = payload;
        message.hash = keccak256(payload);
    }

    function _snapshot(bytes32 account, uint64 lamports, bytes memory data) private pure returns (bytes memory) {
        return abi.encodePacked(
            keccak256("Termbook Solana snapshot v1"), account,
            _le64(lamports), _le32(uint32(data.length)), data
        );
    }

    function _le64(uint64 value) private pure returns (bytes8 result) {
        for (uint256 i; i < 8; ++i) result |= bytes8(uint64(uint8(value >> uint64(8 * i))) << uint64(56 - 8 * i));
    }

    function _le32(uint32 value) private pure returns (bytes4 result) {
        for (uint256 i; i < 4; ++i) result |= bytes4(uint32(uint8(value >> uint32(8 * i))) << uint32(24 - 8 * i));
    }
}
