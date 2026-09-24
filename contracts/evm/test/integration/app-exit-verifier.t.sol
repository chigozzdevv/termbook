// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AppExitVerifier} from "../../src/monad/integration/AppExitVerifier.sol";
import {IAppStateReader} from "../../src/monad/integration/IAppStateReader.sol";

contract ExitCoreFixture {
    address public account;

    function setAccount(address value) external {
        account = value;
    }

    function creditAccount(bytes32) external view returns (address) {
        return account;
    }
}

contract ExitReaderFixture is IAppStateReader {
    uint256 public positions;
    uint256 public pending;

    function setCounts(uint256 positions_, uint256 pending_) external {
        positions = positions_;
        pending = pending_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IAppStateReader).interfaceId;
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
}
