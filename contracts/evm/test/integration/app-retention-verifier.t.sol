// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AppRetentionVerifier} from "../../src/monad/integration/AppRetentionVerifier.sol";
import {IAppRetentionReader} from "../../src/monad/integration/IAppRetentionVerifier.sol";
import {ExitReaderFixture} from "./app-exit-verifier.t.sol";

contract RetentionCoreFixture {
    address public account = address(0x1234);
    address public borrower = address(0x5678);
    uint256 public debt;
    function setDebt(uint256 amount) external { debt = amount; }
    function creditAccount(bytes32) external view returns (address) { return account; }
    function creditBorrower(bytes32) external view returns (address) { return borrower; }
    function creditDebt(bytes32) external view returns (uint256) { return debt; }
    function creditVault(bytes32) external view returns (address) { return address(this); }
    function asset() external pure returns (address) { return address(0x999); }
    function healthMaxAge() external pure returns (uint256) { return 60; }
}
contract RetentionReaderFixture is IAppRetentionReader {
    bool public authorityGone = true;
    bool public isolated = true;
    uint256 public observedAt;
    function setState(bool gone, bool isolated_, uint256 time) external {
        authorityGone = gone; isolated = isolated_; observedAt = time;
    }
    function retentionState(bytes32, address, address) external view returns (bool, bool, bool, uint256) {
        return (true, authorityGone, isolated, observedAt);
    }
}
contract AppRetentionVerifierTest is Test {
    RetentionCoreFixture private core;
    ExitReaderFixture private state;
    RetentionReaderFixture private ownership;
    AppRetentionVerifier private verifier;
    bytes32 private constant ID = keccak256("retention");
    function setUp() public {
        vm.warp(100);
        core = new RetentionCoreFixture(); state = new ExitReaderFixture(); ownership = new RetentionReaderFixture();
        state.setCounts(1, 0); state.setCash(0, block.timestamp); ownership.setState(true, true, block.timestamp);
        verifier = new AppRetentionVerifier(address(core), address(state), address(ownership));
    }
    function canRetain() internal view returns (bool) { return verifier.canRetain(ID, core.account(), core.borrower()); }
    function testRetainsPositionsOnlyWithDebtFreeIsolatedOwnership() public {
        assertTrue(canRetain());
        core.setDebt(1); assertFalse(canRetain()); core.setDebt(0);
        ownership.setState(false, true, block.timestamp); assertFalse(canRetain());
        ownership.setState(true, false, block.timestamp); assertFalse(canRetain());
        ownership.setState(true, true, block.timestamp); assertTrue(canRetain());
        assertFalse(verifier.canRetain(ID, core.account(), address(0xBAD)));
    }
    function testPendingCashAndChangedOrStaleReadersCannotReleaseControl() public {
        state.setCounts(1, 1); assertFalse(canRetain()); state.setCounts(1, 0);
        state.setCash(1, block.timestamp); assertFalse(canRetain()); state.setCash(0, block.timestamp);
        vm.warp(161); assertFalse(canRetain());
        state.setCash(0, block.timestamp); ownership.setState(true, true, block.timestamp); assertTrue(canRetain());
        vm.etch(address(ownership), hex"00"); assertFalse(canRetain());
    }
}
