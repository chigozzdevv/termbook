// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

interface IHouseRegistryVault {
    function asset() external view returns (address);
    function manager() external view returns (address);
}

contract HouseRegistry is ProxyInitializable {
    struct House {
        address vault;
        address asset;
        address manager;
        bool active;
    }

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
        bool riskConfigured;
        bool active;
    }

    mapping(address => House) public houses;
    mapping(address => Policy) public policies;
    mapping(address => address) public houseOfVault;
    mapping(address => address) public policyGovernors;
    address public governance;
    error Unauthorized();
    error Invalid();
    event HouseRegistered(address indexed house, address vault);
    event HouseDisabled(address indexed house);
    event PolicySet(address indexed house, uint256 indexed version);
    event RiskPolicySet(address indexed house, uint256 initialBps, uint256 liquidationBps);
    event PolicyGovernorSet(address indexed house, address indexed governor);

    uint256 private constant PROTOCOL_FLOOR_BPS = 11_000;

    constructor(address governance_) {
        if (governance_ != address(0)) _initializeHouseRegistry(governance_);
    }

    function initialize(address governance_) external initializer {
        _initializeHouseRegistry(governance_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.HouseRegistry.v1");
    }

    function _initializeHouseRegistry(address governance_) private {
        if (governance_ == address(0)) revert Unauthorized();
        governance = governance_;
    }

    function register(address house, address vault, address asset, address manager) external {
        if (
            msg.sender != governance || house == address(0) || vault.code.length == 0 || asset.code.length == 0
                || manager == address(0)
        ) revert Invalid();
        if (IHouseRegistryVault(vault).asset() != asset || IHouseRegistryVault(vault).manager() != manager) {
            revert Invalid();
        }
        if (houseOfVault[vault] != address(0) && houseOfVault[vault] != house && houses[houseOfVault[vault]].active) {
            revert Invalid();
        }
        houses[house] = House(vault, asset, manager, true);
        houseOfVault[vault] = house;
        emit HouseRegistered(house, vault);
    }

    function disable(address house) external {
        if (msg.sender != governance) revert Unauthorized();
        houses[house].active = false;
        policies[house].active = false;
        emit HouseDisabled(house);
    }

    function setPolicy(
        address house,
        uint256 version,
        uint256 maxLimit,
        uint256 minMaturity,
        uint256 maxMaturity,
        uint256 maxAprBps,
        uint256 maxOriginationFeeBps,
        uint256 maxCommitmentFeeBps
    ) external {
        House memory registered = houses[house];
        address governor = policyGovernors[house];
        if (!registered.active || (governor == address(0) ? msg.sender != registered.manager : msg.sender != governor))
        {
            revert Unauthorized();
        }
        if (
            version <= policies[house].version || maxLimit == 0 || minMaturity == 0 || maxMaturity < minMaturity || maxAprBps > 1_000_000
                || maxOriginationFeeBps > 10_000 || maxCommitmentFeeBps > 10_000
        ) revert Invalid();
        policies[house] = Policy({
            version: version,
            maxLimit: maxLimit,
            minMaturity: minMaturity,
            maxMaturity: maxMaturity,
            maxAprBps: maxAprBps,
            maxOriginationFeeBps: maxOriginationFeeBps,
            maxCommitmentFeeBps: maxCommitmentFeeBps,
            initialBps: 0,
            maintenanceBps: 0,
            watchBps: 0,
            freezeBps: 0,
            liquidationBps: 0,
            riskConfigured: false,
            active: true
        });
        emit PolicySet(house, version);
    }

    function setRiskPolicy(
        address house,
        uint256 initialBps,
        uint256 maintenanceBps,
        uint256 watchBps,
        uint256 freezeBps,
        uint256 liquidationBps
    ) external {
        House memory registered = houses[house];
        address governor = policyGovernors[house];
        if (!registered.active || (governor == address(0) ? msg.sender != registered.manager : msg.sender != governor))
        {
            revert Unauthorized();
        }
        if (
            initialBps < maintenanceBps || maintenanceBps <= watchBps || watchBps < freezeBps
                || freezeBps < liquidationBps || liquidationBps < PROTOCOL_FLOOR_BPS
        ) revert Invalid();
        Policy storage policy = policies[house];
        if (!policy.active || policy.riskConfigured) revert Invalid();
        policy.initialBps = initialBps;
        policy.maintenanceBps = maintenanceBps;
        policy.watchBps = watchBps;
        policy.freezeBps = freezeBps;
        policy.liquidationBps = liquidationBps;
        policy.riskConfigured = true;
        emit RiskPolicySet(house, initialBps, liquidationBps);
    }

    function setPolicyGovernor(address house, address governor) external {
        if (msg.sender != governance || !houses[house].active || (governor != address(0) && governor.code.length == 0))
        {
            revert Unauthorized();
        }
        policyGovernors[house] = governor;
        emit PolicyGovernorSet(house, governor);
    }

    function isActiveHouse(address house, address vault) external view returns (bool) {
        House memory registered = houses[house];
        return registered.active && registered.vault == vault && houseOfVault[vault] == house;
    }

    function activePolicyVersion(address house) external view returns (uint256) {
        Policy memory policy = policies[house];
        return policy.active && policy.riskConfigured && houses[house].active ? policy.version : 0;
    }
}
