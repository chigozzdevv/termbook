// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHousePolicyRegistry {
    function setPolicy(
        address house,
        uint256 version,
        uint256 maxLimit,
        uint256 minMaturity,
        uint256 maxMaturity,
        uint256 maxAprBps,
        uint256 maxOriginationFeeBps,
        uint256 maxCommitmentFeeBps
    ) external;

    function setRiskPolicy(
        address house,
        uint256 initialBps,
        uint256 maintenanceBps,
        uint256 watchBps,
        uint256 freezeBps,
        uint256 liquidationBps
    ) external;
}

interface IHousePolicyVault {
    function totalShares() external view returns (uint256);
    function votingPower(address account) external view returns (uint256);
}

contract HousePolicyGovernor {
    struct Policy {
        uint256 version;
        uint256 maxLimit;
        uint256 minMaturity;
        uint256 maxMaturity;
        uint256 maxAprBps;
        uint256 maxOriginationFeeBps;
        uint256 maxCommitmentFeeBps;
        uint256 initialBps;
        uint256 maintenanceBps;
        uint256 watchBps;
        uint256 freezeBps;
        uint256 liquidationBps;
    }

    struct Proposal {
        address proposer;
        uint256 snapshotShares;
        uint256 startAt;
        uint256 endAt;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 eta;
        bool queued;
        bool executed;
        bool cancelled;
        Policy policy;
    }

    IHousePolicyRegistry public immutable registry;
    IHousePolicyVault public immutable vault;
    address public immutable house;
    uint256 public immutable votingDelay;
    uint256 public immutable votingPeriod;
    uint256 public immutable timelock;
    uint256 public immutable quorumBps;
    uint256 public immutable proposalThreshold;
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    error Invalid();
    error Unauthorized();
    error Threshold();
    error VotingClosed();
    error AlreadyVoted();
    error NoVotingPower();
    error Quorum();
    error NotReady();
    error Executed();

    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint256 startAt, uint256 endAt);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalQueued(uint256 indexed proposalId, uint256 eta);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalExecuted(uint256 indexed proposalId);

    constructor(
        address registry_,
        address vault_,
        address house_,
        uint256 votingDelay_,
        uint256 votingPeriod_,
        uint256 timelock_,
        uint256 quorumBps_,
        uint256 proposalThreshold_
    ) {
        if (
            registry_ == address(0) || vault_ == address(0) || house_ == address(0) || registry_.code.length == 0
                || vault_.code.length == 0 || votingPeriod_ == 0 || timelock_ == 0 || quorumBps_ == 0
                || quorumBps_ > 10_000 || proposalThreshold_ == 0
        ) revert Invalid();
        registry = IHousePolicyRegistry(registry_);
        vault = IHousePolicyVault(vault_);
        house = house_;
        votingDelay = votingDelay_;
        votingPeriod = votingPeriod_;
        timelock = timelock_;
        quorumBps = quorumBps_;
        proposalThreshold = proposalThreshold_;
    }

    function propose(Policy calldata policy) external returns (uint256 proposalId) {
        if (vault.votingPower(msg.sender) < proposalThreshold) revert Threshold();
        if (
            policy.version == 0 || policy.maxLimit == 0 || policy.minMaturity == 0
                || policy.maxMaturity < policy.minMaturity
        ) {
            revert Invalid();
        }
        proposalId = ++proposalCount;
        Proposal storage proposal = proposals[proposalId];
        proposal.proposer = msg.sender;
        proposal.snapshotShares = vault.totalShares();
        proposal.startAt = block.timestamp + votingDelay;
        proposal.endAt = proposal.startAt + votingPeriod;
        proposal.policy = policy;
        emit ProposalCreated(proposalId, msg.sender, proposal.startAt, proposal.endAt);
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.proposer == address(0) || block.timestamp < proposal.startAt || block.timestamp >= proposal.endAt)
        {
            revert VotingClosed();
        }
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();
        uint256 weight = vault.votingPower(msg.sender);
        if (weight == 0) revert NoVotingPower();
        hasVoted[proposalId][msg.sender] = true;
        if (support) proposal.forVotes += weight;
        else proposal.againstVotes += weight;
        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    function queue(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (
            proposal.proposer == address(0) || block.timestamp < proposal.endAt || proposal.queued || proposal.cancelled
        ) {
            revert NotReady();
        }
        if (
            proposal.forVotes <= proposal.againstVotes
                || proposal.forVotes + proposal.againstVotes < proposal.snapshotShares * quorumBps / 10_000
        ) {
            revert Quorum();
        }
        proposal.queued = true;
        proposal.eta = block.timestamp + timelock;
        emit ProposalQueued(proposalId, proposal.eta);
    }

    function cancel(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (msg.sender != proposal.proposer || proposal.queued || proposal.executed) revert Unauthorized();
        proposal.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    function execute(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (!proposal.queued || block.timestamp < proposal.eta) revert NotReady();
        if (proposal.executed) revert Executed();
        proposal.executed = true;
        Policy memory policy = proposal.policy;
        registry.setPolicy(
            house,
            policy.version,
            policy.maxLimit,
            policy.minMaturity,
            policy.maxMaturity,
            policy.maxAprBps,
            policy.maxOriginationFeeBps,
            policy.maxCommitmentFeeBps
        );
        registry.setRiskPolicy(
            house, policy.initialBps, policy.maintenanceBps, policy.watchBps, policy.freezeBps, policy.liquidationBps
        );
        emit ProposalExecuted(proposalId);
    }
}
