// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";

interface IProtectionHouse {
    function creditFundingOpen(bytes32 creditId) external view returns (bool);
    function protectionRefundable(bytes32 creditId) external view returns (bool);
    function activeCreditCount() external view returns (uint256);
}

contract RecoveryReserve {
    using SafeTransferLib for address;

    address public immutable asset;
    address public immutable house;
    address public immutable manager;
    uint256 public reserves;
    uint256 public escrowed;
    bool private entered;
    mapping(bytes32 => mapping(uint8 => address[])) private funders;
    mapping(bytes32 => mapping(uint8 => mapping(address => uint256))) public funded;
    mapping(bytes32 => mapping(uint8 => mapping(address => uint256))) public spent;
    mapping(bytes32 => uint256) public reservesSpent;

    error Unauthorized();
    error Invalid();
    event FirstLossFunded(bytes32 indexed creditId, uint8 indexed tier, address indexed funder, uint256 amount);
    event CoverageApplied(bytes32 indexed creditId, uint256 amount);
    event CoverageRestored(bytes32 indexed creditId, uint256 amount);
    event ProtectionRefunded(bytes32 indexed creditId, uint8 indexed tier, address indexed funder, uint256 amount);
    event ReservesFunded(address indexed payer, uint256 amount);
    event ReservesWithdrawn(address indexed recipient, uint256 amount);

    constructor(address asset_, address house_, address manager_) {
        asset = asset_;
        house = house_;
        manager = manager_;
    }

    modifier guarded() {
        if (entered) revert Invalid();
        entered = true;
        _;
        entered = false;
    }

    function fundFirstLoss(bytes32 creditId, uint8 tier, uint256 amount) external guarded {
        if (tier > 1 || amount == 0 || !IProtectionHouse(house).creditFundingOpen(creditId)) revert Invalid();
        address[] storage participants = funders[creditId][tier];
        if (funded[creditId][tier][msg.sender] == 0 && spent[creditId][tier][msg.sender] == 0) {
            if (participants.length == 8) revert Invalid();
            participants.push(msg.sender);
        }
        _receive(msg.sender, amount);
        funded[creditId][tier][msg.sender] += amount;
        emit FirstLossFunded(creditId, tier, msg.sender, amount);
    }

    function fundReserves(uint256 amount) external guarded {
        if (amount == 0) revert Invalid();
        _receive(msg.sender, amount);
        reserves += amount;
        emit ReservesFunded(msg.sender, amount);
    }

    function withdrawReserves(address recipient, uint256 amount) external guarded {
        if (msg.sender != manager) revert Unauthorized();
        if (recipient == address(0) || amount == 0 || amount > reserves
            || IProtectionHouse(house).activeCreditCount() != 0) revert Invalid();
        reserves -= amount;
        escrowed -= amount;
        asset.safeTransfer(recipient, amount);
        emit ReservesWithdrawn(recipient, amount);
    }

    function cover(bytes32 creditId, uint256 loss) external guarded returns (uint256 covered) {
        if (msg.sender != house) revert Unauthorized();
        uint256 remaining = loss;
        for (uint8 tier; tier < 2; ++tier) {
            address[] storage participants = funders[creditId][tier];
            uint256 total;
            for (uint256 i; i < participants.length; ++i) total += funded[creditId][tier][participants[i]];
            uint256 use = remaining < total ? remaining : total;
            uint256 allocated;
            uint256 weightLeft = total;
            for (uint256 i; i < participants.length && use != 0; ++i) {
                address participant = participants[i];
                uint256 balance = funded[creditId][tier][participant];
                uint256 take = weightLeft == balance ? use - allocated : use * balance / total;
                weightLeft -= balance;
                funded[creditId][tier][participant] -= take;
                spent[creditId][tier][participant] += take;
                allocated += take;
            }
            covered += use;
            remaining -= use;
        }
        uint256 reserveUse = remaining < reserves ? remaining : reserves;
        reserves -= reserveUse;
        reservesSpent[creditId] += reserveUse;
        covered += reserveUse;
        escrowed -= covered;
        if (covered != 0) asset.safeTransfer(house, covered);
        emit CoverageApplied(creditId, covered);
    }

    function restore(bytes32 creditId, uint256 amount) external guarded returns (uint256 restored) {
        if (msg.sender != house) revert Unauthorized();
        uint256 reserveSpent = reservesSpent[creditId];
        uint256 reserveRestore = amount < reserveSpent ? amount : reserveSpent;
        reservesSpent[creditId] -= reserveRestore;
        reserves += reserveRestore;
        restored = reserveRestore;
        for (uint8 index; index < 2; ++index) {
            uint8 tier = 1 - index;
            address[] storage participants = funders[creditId][tier];
            uint256 total;
            for (uint256 i; i < participants.length; ++i) total += spent[creditId][tier][participants[i]];
            uint256 remaining = amount - restored;
            uint256 use = remaining < total ? remaining : total;
            uint256 allocated;
            uint256 weightLeft = total;
            for (uint256 i; i < participants.length && use != 0; ++i) {
                address participant = participants[i];
                uint256 balance = spent[creditId][tier][participant];
                uint256 give = weightLeft == balance ? use - allocated : use * balance / total;
                weightLeft -= balance;
                spent[creditId][tier][participant] -= give;
                funded[creditId][tier][participant] += give;
                allocated += give;
            }
            restored += use;
        }
        if (restored != 0) _receive(house, restored);
        emit CoverageRestored(creditId, restored);
    }

    function refund(bytes32 creditId, uint8 tier) external guarded returns (uint256 amount) {
        if (tier > 1 || !IProtectionHouse(house).protectionRefundable(creditId)) revert Invalid();
        amount = funded[creditId][tier][msg.sender];
        if (amount == 0) revert Invalid();
        funded[creditId][tier][msg.sender] = 0;
        escrowed -= amount;
        asset.safeTransfer(msg.sender, amount);
        emit ProtectionRefunded(creditId, tier, msg.sender, amount);
    }

    function _receive(address payer, uint256 amount) private {
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(payer, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert Invalid();
        escrowed += amount;
    }
}
