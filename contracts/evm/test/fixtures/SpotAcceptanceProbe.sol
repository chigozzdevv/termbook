// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {AtomicSpotRouter} from "../../src/monad/integration/AtomicSpotRouter.sol";
import {SafeTransferLib} from "../../src/shared/SafeTransferLib.sol";

contract SpotAcceptanceProbe {
    function nativeBalance(address account) external view returns (uint256) { return account.balance; }
}

// A callback account exercises the shared router's nested-call guard on a real market.
contract SpotCallbackFixture {
    using SafeTransferLib for address;
    address public immutable owner = msg.sender;
    AtomicSpotRouter public router;
    address public token;
    bytes32 public bundle;
    bytes32 public route;
    bool private callback;
    bytes32 public constant creditId = keccak256("callback-fixture");

    function core() external view returns (address) { return address(this); }
    function creditDetails(bytes32 id) external view returns (TermbookCore.Credit memory credit) {
        require(id == creditId);
        credit.account = address(this); credit.bundleId = bundle;
    }
    function configure(address router_, address token_, bytes32 bundle_, bytes32 route_) external {
        require(msg.sender == owner && address(router) == address(0));
        router = AtomicSpotRouter(payable(router_)); token = token_; bundle = bundle_; route = route_;
    }
    function run(bool nested) external {
        require(msg.sender == owner);
        callback = nested;
        token.safeApprove(address(router), 10_000);
        router.trade(route, 10_000, 1);
        token.safeApprove(address(router), 0);
    }
    receive() external payable {
        if (callback) router.trade(route, 10_000, 1);
    }
}
