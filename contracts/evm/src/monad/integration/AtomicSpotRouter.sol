// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TermbookCore} from "../credit/TermbookCore.sol";
import {CreditAccount} from "../credit/CreditAccount.sol";
import {IntegrationRegistry} from "./IntegrationRegistry.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {FullMath} from "../../shared/FullMath.sol";

contract AtomicSpotRouter {
    using SafeTransferLib for address;

    struct Route {
        bytes32 bundle;
        address target;
        address input;
        address output;
        bytes4 selector;
        uint8 amountWord;
        uint8 minimumWord;
        uint256 numerator;
        uint256 denominator;
        uint256 minimumSize;
        uint256 maximumSize;
        bytes32[] words;
    }

    address public immutable governance;
    TermbookCore public immutable core;
    IntegrationRegistry public immutable registry;
    mapping(bytes32 => Route) private routes;
    mapping(bytes32 => bytes32) public routeHashes;
    bool private entered;

    error Invalid();
    error Unauthorized();
    event RouteConfigured(bytes32 indexed id, bytes32 indexed bundle, bytes32 hash);

    constructor(address governance_, address core_, address registry_) {
        if (governance_ == address(0) || core_.code.length == 0 || registry_.code.length == 0) revert Invalid();
        governance = governance_;
        core = TermbookCore(core_);
        registry = IntegrationRegistry(registry_);
    }

    receive() external payable {}

    function configure(bytes32 id, Route calldata value) external {
        if (msg.sender != governance) revert Unauthorized();
        if (id == bytes32(0) || routeHashes[id] != bytes32(0) || value.bundle == bytes32(0)
            || value.target.code.length == 0 || value.input == value.output || value.selector == bytes4(0)
            || value.words.length == 0 || value.words.length > 24 || value.amountWord >= value.words.length
            || value.minimumWord >= value.words.length || value.amountWord == value.minimumWord
            || value.words[value.amountWord] != bytes32(0) || value.words[value.minimumWord] != bytes32(0)
            || value.numerator == 0 || value.denominator == 0 || value.minimumSize == 0
            || value.maximumSize < value.minimumSize || value.maximumSize > type(uint96).max
            || value.input != address(0) && value.input.code.length == 0
            || value.output != address(0) && value.output.code.length == 0) revert Invalid();
        routes[id] = value;
        routeHashes[id] = keccak256(abi.encode(value));
        emit RouteConfigured(id, value.bundle, routeHashes[id]);
    }

    function route(bytes32 id) external view returns (Route memory) { return routes[id]; }

    function sizedInput(bytes32 id, uint256 amount) public view returns (uint256 encoded, uint256 raw) {
        Route storage value = routes[id];
        if (routeHashes[id] == bytes32(0)) revert Invalid();
        encoded = FullMath.mulDiv(amount, value.numerator, value.denominator, false);
        if (encoded < value.minimumSize || encoded > value.maximumSize) revert Invalid();
        raw = FullMath.mulDiv(encoded, value.denominator, value.numerator, false);
        if (raw == 0 || raw > amount) revert Invalid();
    }

    function trade(bytes32 id, uint256 amount, uint256 minimumOut) external payable returns (uint256 output) {
        if (entered) revert Invalid();
        entered = true;
        Route storage value = routes[id];
        bytes32 creditId = CreditAccount(payable(msg.sender)).creditId();
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        if (CreditAccount(payable(msg.sender)).core() != address(core) || credit.account != msg.sender
            || credit.bundleId != value.bundle || !registry.dependenciesValid(value.bundle)
            || !registry.dependencyValid(value.bundle, value.target)
            || value.input != address(0) && !registry.dependencyValid(value.bundle, value.input)
            || value.output != address(0) && !registry.dependencyValid(value.bundle, value.output)
            || minimumOut == 0) revert Unauthorized();
        (uint256 encoded, uint256 raw) = sizedInput(id, amount);
        if (value.input == address(0) ? msg.value != amount : msg.value != 0) revert Invalid();
        uint256 inputBefore = _balance(value.input) - msg.value;
        uint256 outputBefore = _balance(value.output);
        if (value.input != address(0)) {
            value.input.safeTransferFrom(msg.sender, address(this), raw);
            if (_balance(value.input) != inputBefore + raw) revert Invalid();
            value.input.safeApprove(value.target, 0);
            value.input.safeApprove(value.target, raw);
        }
        bytes memory data = new bytes(4 + value.words.length * 32);
        bytes4 selector = value.selector;
        assembly { mstore(add(data, 32), selector) }
        for (uint256 i; i < value.words.length; ++i) {
            bytes32 word = i == value.amountWord ? bytes32(encoded) : i == value.minimumWord ? bytes32(minimumOut) : value.words[i];
            assembly { mstore(add(add(data, 36), mul(i, 32)), word) }
        }
        (bool ok, bytes memory result) = value.target.call{value: value.input == address(0) ? raw : 0}(data);
        if (!ok) { assembly { revert(add(result, 32), mload(result)) } }
        if (value.input != address(0)) value.input.safeApprove(value.target, 0);
        uint256 afterInput = _balance(value.input);
        uint256 afterOutput = _balance(value.output);
        if (afterInput < inputBefore || afterOutput < outputBefore) revert Invalid();
        output = afterOutput - outputBefore;
        if (output < minimumOut) revert Invalid();
        uint256 refund = afterInput - inputBefore;
        if (refund > amount) revert Invalid();
        _send(value.input, msg.sender, refund);
        uint256 recipientBefore = value.output == address(0) ? msg.sender.balance : value.output.balanceOf(msg.sender);
        _send(value.output, msg.sender, output);
        uint256 recipientAfter = value.output == address(0) ? msg.sender.balance : value.output.balanceOf(msg.sender);
        if (recipientAfter < recipientBefore || recipientAfter - recipientBefore != output
            || _balance(value.input) != inputBefore || _balance(value.output) != outputBefore) revert Invalid();
        entered = false;
    }

    function _balance(address asset) private view returns (uint256) {
        return asset == address(0) ? address(this).balance : asset.balanceOf(address(this));
    }

    function _send(address asset, address recipient, uint256 amount) private {
        if (amount == 0) return;
        if (asset != address(0)) asset.safeTransfer(recipient, amount);
        else { (bool ok,) = payable(recipient).call{value: amount}(""); if (!ok) revert Invalid(); }
    }
}
