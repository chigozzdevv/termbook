// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RealFlowTest} from "../integration/real-flow.t.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {ExecutionManager} from "../../src/monad/integration/ExecutionManager.sol";
import {ReservationManager} from "../../src/monad/house/ReservationManager.sol";
import {PriceProtection} from "../../src/monad/integration/PriceProtection.sol";
import {TestnetProxy} from "../../src/monad/governance/TestnetProxy.sol";
import {UpgradeController} from "../../src/monad/governance/UpgradeController.sol";
import {Types} from "../../src/shared/Types.sol";

contract TermbookCoreV2 is TermbookCore {
    constructor() TermbookCore(address(0), address(0), address(0), address(0), address(0), address(0)) {}
    function implementationVersion() external pure returns (uint256) { return 2; }
}

contract UpgradeFlowTest is RealFlowTest {
    UpgradeController upgrades;
    function _deployCore(address governance, address guardian, address risk_) internal override returns (TermbookCore deployed) {
        vm.chainId(10143);
        upgrades = new UpgradeController(address(this));
        address logic = deployCode("TermbookCore.sol:TermbookCore", abi.encode(address(0), address(0), address(0), address(0), address(0), address(0)));
        address executionLogic = deployCode("FlowExecutor.sol:FlowExecutor", abi.encode(address(0)));
        address reservationLogic = deployCode("ReservationManager.sol:ReservationManager", abi.encode(address(0)));
        address priceLogic = deployCode("PriceProtection.sol:PriceProtection", abi.encode(address(0)));
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 3);
        TestnetProxy execution = new TestnetProxy(executionLogic, address(upgrades), abi.encodeCall(ExecutionManager.initialize, (predicted)));
        TestnetProxy reservation = new TestnetProxy(reservationLogic, address(upgrades), abi.encodeCall(ReservationManager.initialize, (predicted)));
        TestnetProxy prices = new TestnetProxy(priceLogic, address(upgrades), abi.encodeCall(PriceProtection.initialize, (predicted)));
        TestnetProxy coreProxy = new TestnetProxy(logic, address(upgrades),
            abi.encodeCall(TermbookCore.initialize, (governance, guardian, risk_, address(execution), address(reservation), address(prices))));
        assertEq(address(coreProxy), predicted);
        upgrades.register(execution); upgrades.register(reservation); upgrades.register(prices); upgrades.register(coreProxy);
        deployed = TermbookCore(address(coreProxy));
        assertEq(deployed.healthMaxAge(), 1 days);
        assertEq(deployed.domain(), keccak256(abi.encode("termbook-v1", block.chainid, predicted)));
    }
    function testLiveCreditCanRepayAndCloseAfterCompatibleUpgrade() public {
        bytes32 id = keccak256("upgrade credit");
        (bytes32 lockId, address account) = _prepare(id);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(abi.encode(core.domain(), id, uint256(400), uint256(400), uint256(1), deadline, core.creditRevision(id)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(borrowerKey, digest);
        core.draw(id, 400, 400, 1, deadline, abi.encodePacked(r, s, v));
        uint256 revision = core.creditRevision(id);
        bytes32 domain = core.domain();
        address next = deployCode("upgrade-flow.t.sol:TermbookCoreV2");
        upgrades.upgrade(TestnetProxy(payable(address(core))), next, next.codehash, "");
        assertEq(TermbookCoreV2(address(core)).implementationVersion(), 2);
        assertEq(core.creditAccount(id), account);
        assertEq(core.creditBorrower(id), borrower);
        assertEq(core.creditRevision(id), revision);
        assertEq(core.domain(), domain);
        assertEq(core.acceptedCredits(), 1);
        assertEq(token.balanceOf(account), 400);
        vm.startPrank(borrower);
        token.approve(address(core), 400); core.repay(id, 400); core.startClosing(id);
        _recordHealth(id, Types.HealthSnapshot(0, 400, 0, 0, 0, 0, 0, 400, 0));
        core.withdraw(id, address(token), borrower, 400);
        core.authorizeReturn(id, lockId, 250); core.authorizeReturn(id, lockId, 250);
        vm.stopPrank(); core.finishClose(id);
        assertEq(token.balanceOf(borrower), 1_000);
    }
}
