// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RouteRegistry {
    struct Route {
        address adapter;
        bytes32 assetPair;
        bool active;
        uint256 maxAmount;
        uint256 version;
    }

    mapping(bytes32 => Route) public routes;
    address public immutable governance;
    error Unauthorized();
    error Invalid();
    event RouteSet(bytes32 indexed id, address adapter, uint256 version);
    event RouteDisabled(bytes32 indexed id);

    constructor(address governance_) {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
    }

    function setRoute(bytes32 id, address adapter, bytes32 assetPair, uint256 maxAmount) external {
        if (msg.sender != governance || id == bytes32(0) || adapter.code.length == 0 || assetPair == bytes32(0) || maxAmount == 0) revert Invalid();
        uint256 version = routes[id].version + 1;
        routes[id] = Route(adapter, assetPair, true, maxAmount, version);
        emit RouteSet(id, adapter, version);
    }

    function disable(bytes32 id) external {
        if (msg.sender != governance) revert Unauthorized();
        routes[id].active = false;
        emit RouteDisabled(id);
    }
}
