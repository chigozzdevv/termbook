// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

contract ReservationManager is ProxyInitializable {
    struct Policy {
        address vault;
        uint32 maxSetupDuration;
        uint16 annualRateBps;
        uint16 maxBorrowerCount;
        uint32 maxHouseCount;
        uint256 maxBorrowerLimit;
        uint256 maxHouseLimit;
        uint256 readyFee;
        uint256 abandonFee;
        uint256 expiryFee;
        uint256 repeatPenalty;
        uint16 maxSlippageBps;
    }
    struct Authorization { bytes32 policyHash; address payer; address refundRecipient; }
    struct SponsorGrant {
        address borrower;
        address vault;
        bytes32 policyHash;
        address refundRecipient;
        uint256 maxBond;
        uint256 expiry;
    }
    struct Reservation {
        address house;
        address borrower;
        address payer;
        address refundRecipient;
        uint256 version;
        uint256 limit;
        uint256 bond;
        uint256 startedAt;
        uint256 deadline;
        uint256 penalty;
        bool active;
    }
    enum Outcome { Ready, Abandoned, Expired, ProtocolFailure }
    address public core;
    uint256 public constant MINIMUM_ANNUAL_RATE_BPS = 100;
    mapping(address => mapping(uint256 => Policy)) public policies;
    mapping(address => mapping(uint256 => bytes32)) public policyHashes;
    mapping(bytes32 => Reservation) public reservations;
    mapping(bytes32 => mapping(address => SponsorGrant)) public sponsorGrants;
    mapping(address => uint256) public houseCount;
    mapping(address => uint256) public houseLimit;
    mapping(address => mapping(address => uint256)) public borrowerCount;
    mapping(address => mapping(address => uint256)) public borrowerLimit;
    mapping(address => mapping(address => uint256)) public abandonments;
    error Unauthorized();
    error Invalid();
    error OverLimit();
    event PolicyConfigured(address indexed house, uint256 indexed version, bytes32 policyHash);
    event SponsorAuthorized(bytes32 indexed creditId, address indexed payer, uint256 maxBond, uint256 expiry);
    event ReservationSettled(bytes32 indexed creditId, Outcome outcome, uint256 charge, uint256 refund);
    modifier onlyCore() { if (msg.sender != core) revert Unauthorized(); _; }
    constructor(address core_) {
        if (core_ != address(0)) _initializeReservationManager(core_);
    }

    function initialize(address core_) external initializer {
        _initializeReservationManager(core_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.ReservationManager.v1");
    }

    function _initializeReservationManager(address core_) private { if (core_ == address(0)) revert Invalid(); core = core_; }

    function configure(address house, uint256 version, Policy calldata policy) external onlyCore {
        if (house == address(0) || version == 0 || policy.vault.code.length == 0
            || policyHashes[house][version] != bytes32(0) || policy.maxSetupDuration == 0
            || policy.maxSetupDuration > 7 days || policy.annualRateBps < MINIMUM_ANNUAL_RATE_BPS
            || policy.annualRateBps > 10_000 || policy.maxBorrowerCount == 0
            || policy.maxHouseCount < policy.maxBorrowerCount || policy.maxBorrowerLimit == 0
            || policy.maxHouseLimit < policy.maxBorrowerLimit || policy.maxSlippageBps > 5_000) revert Invalid();
        policies[house][version] = policy;
        bytes32 hash = keccak256(abi.encode(block.chainid, core, house, version, policy));
        policyHashes[house][version] = hash;
        emit PolicyConfigured(house, version, hash);
    }

    function authorizeSponsor(bytes32 creditId, SponsorGrant calldata grant) external {
        if (creditId == bytes32(0) || reservations[creditId].startedAt != 0 || grant.borrower == address(0)
            || grant.vault.code.length == 0 || grant.policyHash == bytes32(0) || grant.refundRecipient == address(0)
            || grant.maxBond == 0 || grant.expiry <= block.timestamp) revert Invalid();
        sponsorGrants[creditId][msg.sender] = grant;
        emit SponsorAuthorized(creditId, msg.sender, grant.maxBond, grant.expiry);
    }
    function revokeSponsor(bytes32 creditId) external { delete sponsorGrants[creditId][msg.sender]; }

    function minimumBond(address house, uint256 version, address borrower, uint256 limit, uint256 duration)
        public view returns (uint256) {
        Policy memory policy = policies[house][version];
        if (policyHashes[house][version] == bytes32(0) || duration == 0 || duration > policy.maxSetupDuration
            || limit == 0 || limit > policy.maxBorrowerLimit) revert Invalid();
        uint256 count = abandonments[house][borrower];
        uint256 penalty = policy.repeatPenalty * (count > 10 ? 10 : count);
        uint256 fee = policy.readyFee;
        if (policy.abandonFee + penalty > fee) fee = policy.abandonFee + penalty;
        if (policy.expiryFee + penalty > fee) fee = policy.expiryFee + penalty;
        return fee + _rent(limit, policy.annualRateBps, duration);
    }

    function reserve(bytes32 creditId, address house, uint256 version, address vault, address borrower, uint256 limit,
        uint256 bond, uint256 deadline, Authorization calldata auth) external onlyCore returns (address payer) {
        Policy memory policy = policies[house][version];
        if (reservations[creditId].startedAt != 0 || creditId == bytes32(0) || borrower == address(0) || vault != policy.vault
            || deadline <= block.timestamp || auth.policyHash != policyHashes[house][version]
            || auth.policyHash == bytes32(0)
            || bond < minimumBond(house, version, borrower, limit, deadline - block.timestamp)) revert Invalid();
        if (houseCount[house] >= policy.maxHouseCount || borrowerCount[house][borrower] >= policy.maxBorrowerCount
            || houseLimit[house] > policy.maxHouseLimit || borrowerLimit[house][borrower] > policy.maxBorrowerLimit
            || limit > policy.maxHouseLimit - houseLimit[house]
            || limit > policy.maxBorrowerLimit - borrowerLimit[house][borrower]) revert OverLimit();
        payer = auth.payer == address(0) ? borrower : auth.payer;
        address recipient = auth.refundRecipient == address(0) ? payer : auth.refundRecipient;
        if (payer != borrower) {
            SponsorGrant memory grant = sponsorGrants[creditId][payer];
            if (grant.borrower != borrower || grant.vault != policy.vault || grant.policyHash != auth.policyHash
                || grant.refundRecipient != recipient || bond > grant.maxBond || block.timestamp >= grant.expiry) revert Unauthorized();
            delete sponsorGrants[creditId][payer];
        } else if (recipient != borrower) revert Unauthorized();
        uint256 count = abandonments[house][borrower];
        reservations[creditId] = Reservation(house, borrower, payer, recipient, version, limit, bond,
            block.timestamp, deadline, policy.repeatPenalty * (count > 10 ? 10 : count), true);
        houseCount[house] += 1; houseLimit[house] += limit;
        borrowerCount[house][borrower] += 1; borrowerLimit[house][borrower] += limit;
    }

    function settle(bytes32 creditId, Outcome outcome) external onlyCore
        returns (uint256 charge, uint256 refund, address recipient) {
        Reservation storage reservation = reservations[creditId];
        if (!reservation.active) revert Invalid();
        if (outcome == Outcome.Ready && block.timestamp > reservation.deadline
            || outcome == Outcome.Expired && block.timestamp <= reservation.deadline) revert Invalid();
        Policy memory policy = policies[reservation.house][reservation.version];
        if (outcome != Outcome.ProtocolFailure) {
            uint256 end = block.timestamp < reservation.deadline ? block.timestamp : reservation.deadline;
            charge = _rent(reservation.limit, policy.annualRateBps, end - reservation.startedAt);
            if (outcome == Outcome.Ready) charge += policy.readyFee;
            else {
                charge += (outcome == Outcome.Expired ? policy.expiryFee : policy.abandonFee) + reservation.penalty;
                abandonments[reservation.house][reservation.borrower] += 1;
            }
        }
        if (charge > reservation.bond) revert OverLimit();
        refund = reservation.bond - charge;
        recipient = reservation.refundRecipient;
        reservation.active = false;
        houseCount[reservation.house] -= 1; houseLimit[reservation.house] -= reservation.limit;
        borrowerCount[reservation.house][reservation.borrower] -= 1;
        borrowerLimit[reservation.house][reservation.borrower] -= reservation.limit;
        emit ReservationSettled(creditId, outcome, charge, refund);
    }
    function maxSlippage(address house, uint256 version) external view returns (uint16) {
        return policies[house][version].maxSlippageBps;
    }
    function active(bytes32 creditId) external view returns (bool) { return reservations[creditId].active; }
    function _rent(uint256 limit, uint256 rate, uint256 duration) private pure returns (uint256) {
        uint256 numerator = limit * rate * duration;
        return numerator == 0 ? 0 : (numerator - 1) / (10_000 * 365 days) + 1;
    }
}
