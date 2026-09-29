// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AppExitVerifier} from "../../src/monad/integration/AppExitVerifier.sol";
import {IAppStateReader} from "../../src/monad/integration/IAppStateReader.sol";
import {IAppCashReader} from "../../src/monad/integration/IAppCashReader.sol";

contract ExitCoreFixture {
    address public account;

    function setAccount(address value) external {
        account = value;
    }

    function creditAccount(bytes32) external view returns (address) {
        return account;
    }
    function creditVault(bytes32) external view returns (address) { return address(this); }
    function healthMaxAge() external pure returns (uint256) { return 1 days; }
    function asset() external pure returns (address) { return address(0x777); }
}

contract ExitReaderFixture is IAppStateReader {
    uint256 public positions;
    uint256 public pending;
    uint256 public reserved;
    uint256 public observedAt;

    function setCash(uint256 reserved_, uint256 observedAt_) external { reserved = reserved_; observedAt = observedAt_; }
    function reservedCash(bytes32, address, address) external view returns (uint256, uint256) {
        return (reserved, observedAt);
    }

    function setCounts(uint256 positions_, uint256 pending_) external {
        positions = positions_;
        pending = pending_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IAppStateReader).interfaceId || interfaceId == type(IAppCashReader).interfaceId;
    }

    function positionCount(bytes32, address) external view returns (uint256) {
        return positions;
    }

    function positionAt(bytes32, address, uint256) external pure returns (bytes32, bytes32) {
        return (bytes32(0), bytes32(0));
    }

    function pendingCount(bytes32, address) external view returns (uint256) {
        return pending;
    }

    function pendingAt(bytes32, address, uint256) external pure returns (bytes32, bytes32, uint256, uint256) {
        return (bytes32(0), bytes32(0), 0, 0);
    }
}

contract AppExitVerifierTest is Test {
    bytes32 private constant CREDIT_ID = keccak256("credit");
    address private constant ACCOUNT = address(0x1234);
    ExitCoreFixture private core;
    ExitReaderFixture private reader;
    AppExitVerifier private verifier;

    function setUp() public {
        core = new ExitCoreFixture();
        reader = new ExitReaderFixture();
        reader.setCash(0, block.timestamp);
        core.setAccount(ACCOUNT);
        verifier = new AppExitVerifier(address(core), address(reader));
    }

    function testExitRequiresNoPositionsOrPendingActionsForBoundAccount() public {
        assertTrue(verifier.canExit(CREDIT_ID, ACCOUNT));
        reader.setCounts(1, 0);
        assertFalse(verifier.canExit(CREDIT_ID, ACCOUNT));
        reader.setCounts(0, 1);
        assertFalse(verifier.canExit(CREDIT_ID, ACCOUNT));
        reader.setCounts(0, 0);
        assertFalse(verifier.canExit(CREDIT_ID, address(0x5678)));
        vm.etch(address(reader), hex"00");
        assertFalse(verifier.canExit(CREDIT_ID, ACCOUNT));
    }

    function testSeniorCashObligationsAndStaleStateBlockExit() public {
        reader.setCash(1, block.timestamp);
        assertFalse(verifier.canExit(CREDIT_ID, ACCOUNT));
        reader.setCash(0, block.timestamp);
        vm.warp(block.timestamp + 1 days + 1);
        assertFalse(verifier.canExit(CREDIT_ID, ACCOUNT));
        reader.setCash(0, block.timestamp);
        assertTrue(verifier.canExit(CREDIT_ID, ACCOUNT));
    }
}
