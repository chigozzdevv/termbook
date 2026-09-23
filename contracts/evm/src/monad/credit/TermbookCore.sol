// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../../shared/Types.sol";
import {Events} from "../../shared/Events.sol";
import {RevisionLib} from "../../shared/RevisionLib.sol";
import {AuthLib} from "../../shared/AuthLib.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {RemoteAction} from "../../shared/collateral/RemoteAction.sol";
import {ITermbookCore} from "./ITermbookCore.sol";
import {IExitVerifier} from "../integration/IExitVerifier.sol";

interface IHouseVaultCore {
    function core() external view returns (address);
    function asset() external view returns (address);
    function setProtocolFee(address recipient, uint256 feeBps) external;
    function reserve(bytes32 creditId, uint256 amount) external;
    function release(bytes32 creditId, uint256 amount) external;
    function fundDraw(bytes32 creditId, address account, uint256 amount) external;
    function receiveRepay(bytes32 creditId, uint256 amount) external;
    function receiveRepay(
        bytes32 creditId,
        uint256 amount,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 feePaid
    ) external;
    function applyRepaymentSettlement(
        bytes32 creditId,
        address inbox,
        uint256 amount,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 feePaid
    ) external;
    function recordAccruedReceivable(bytes32 creditId, uint256 amount) external;
    function restoreCommitment(bytes32 creditId, uint256 amount) external;
    function creditCommitted(bytes32 creditId) external view returns (uint256);
    function collectBond(bytes32 creditId, address from, uint256 amount) external;
    function settleBond(bytes32 creditId, uint256 amount) external;
    function refundBond(bytes32 creditId, address recipient, uint256 amount) external;
}

interface ICollateralVaultCore {
    function core() external view returns (address);
    function asset() external view returns (address);
    function chainId_() external view returns (uint256);
    function lockInfo(bytes32 lockId)
        external
        view
        returns (bytes32, address, address, uint256, uint256, address, uint256, uint256, bool, bool, bool);
    function release(bytes32 lockId, address recipient, uint256 amount, uint256 nonce) external;
    function seize(bytes32 lockId, address recipient, uint256 amount) external;
    function setPauseGuardian(address guardian) external;
}

interface ICreditAccountCore {
    function creditId() external view returns (bytes32);
    function borrower() external view returns (address);
    function core() external view returns (address);
    function execute(address target, bytes calldata data) external returns (bytes memory);
    function approveSpend(address token, address spender, uint256 amount) external;
    function transferToken(address token, address to, uint256 amount) external;
    function tokenBalance(address token) external view returns (uint256);
}

interface IRiskCore {
    function riskState(bytes32 creditId) external view returns (Types.Risk);
    function maintenanceBps(bytes32 creditId) external view returns (uint256);
    function checkDraw(bytes32 creditId, uint256 newDebt) external view;
    function checkWithdraw(bytes32 creditId, uint256 cashAfter) external view;
    function applyCashWithdraw(bytes32 creditId, uint256 cashAfter) external;
    function checkCollateralWithdraw(bytes32 creditId, uint256 sourceValueAfter) external view;
    function applyCollateralWithdraw(bytes32 creditId, uint256 sourceValueAfter) external;
    function record(bytes32 creditId, Types.HealthSnapshot calldata snapshot) external;
    function setRiskBands(
        bytes32 creditId,
        uint256 initial_,
        uint256 maintenance_,
        uint256 watch_,
        uint256 freeze_,
        uint256 liquidation_
    ) external;
    function snapshot(bytes32 creditId) external view returns (Types.HealthSnapshot memory);
}

interface IHealthSourceCore {
    function snapshot(bytes32 creditId, bytes32 bundleId, uint256 revision, uint256 debt)
        external
        view
        returns (Types.HealthSnapshot memory);
}

interface IOracleRegistrySaleCore {
    function read(bytes32 id) external view returns (uint256 value, uint256 updatedAt, uint80 roundId);
}

interface IIntegrationRegistryCore {
    function validateCall(bytes32 versionId, address target, bytes calldata data, address account, uint256 drawAmount)
        external
        view
        returns (bool);
}

interface IVerifierRegistryCore {
    function verifiers(uint256 chainId)
        external
        view
        returns (address impl, uint256 version, bool active, uint256 maxAge, bytes32 codeHash);
}

interface IHouseRegistryCore {
    function isActiveHouse(address house, address vault) external view returns (bool);
    function policies(address house)
        external
        view
        returns (
            uint256 version,
            uint256 maxLimit,
            uint256 minMaturity,
            uint256 maxMaturity,
            uint256 maxAprBps,
            uint256 maxOriginationFeeBps,
            uint256 maxCommitmentFeeBps,
            uint256 initialBps,
            uint256 maintenanceBps,
            uint256 watchBps,
            uint256 freezeBps,
            uint256 liquidationBps,
            bool riskConfigured,
            bool active
        );
}

interface IVerifierCore {
    function verifyFinality(bytes calldata header) external view returns (bool);
    function verifyInclusion(bytes calldata proof, bytes32 root) external view returns (bool);
    function headerRoot(bytes calldata header) external view returns (bytes32);
    function proofLeaf(bytes calldata proof) external view returns (bytes32);
    function verifyEvent(bytes calldata header, bytes calldata proof, address emitter, bytes32 eventDigest)
        external view returns (bool);
    function verifyLock(bytes calldata header, bytes calldata proof, address vault, bytes32 lockDigest)
        external view returns (bool);
}

interface ISolanaVerifierCore {
    function verifySolanaLock(
        bytes calldata header,
        bytes calldata proof,
        bytes32 sourceGenesis,
        bytes32 programId,
        bytes32 lockDigest
    ) external view returns (bool);
    function verifySolanaAction(
        bytes calldata header,
        bytes calldata proof,
        bytes32 sourceGenesis,
        bytes32 programId,
        bytes32 lockPda,
        bytes32 actionDigest
    ) external view returns (bool);
}

interface IUnconsumedRemoteActionVerifier {
    function sourceController() external view returns (address);
    function sourceVault() external view returns (address);
    function verifyUnconsumedAction(
        bytes calldata header,
        bytes calldata proof,
        address controller,
        bytes32 actionHash,
        uint256 deadline
    ) external view returns (bool);
}

contract TermbookCore is ITermbookCore {
    using SafeTransferLib for address;

    struct Credit {
        Types.Facility facility;
        Types.Payment payment;
        address borrower;
        address house;
        address vault;
        address account;
        address collateralVault;
        address collateralAsset;
        address returnRecipient;
        uint256 collateralAmount;
        uint256 limit;
        uint256 debt;
        uint256 drawn;
        uint256 maturity;
        uint256 grace;
        uint256 setupDeadline;
        uint256 reservationBond;
        uint256 revision;
        uint256 nonce;
        uint256 recovery;
        bytes32 bundleId;
        bytes32 termsHash;
        bytes32 lockId;
        bool collateralBound;
        bool collateralReturned;
        bool recoveryFinalized;
        bool revolving;
        uint256 principal;
        uint256 accruedInterest;
        uint256 accruedFees;
        uint256 aprBps;
        uint256 originationFee;
        uint256 commitmentFeeBps;
        uint256 policyVersion;
        uint256 verifierVersion;
        bytes32 verifierCodeHash;
        uint256 accruedAt;
        bool originationCharged;
    }

    struct AcceptParams {
        bytes32 creditId;
        bytes32 intentId;
        address borrower;
        address house;
        address vault;
        uint256 limit;
        uint256 maturity;
        bool revolving;
        bytes32 bundleId;
        uint256 setupDeadline;
        uint256 grace;
        uint256 reservationBond;
        bytes32 termsHash;
        uint256 houseNonce;
        uint256 expiry;
        bytes houseSig;
        uint256 aprBps;
        uint256 originationFee;
        uint256 commitmentFeeBps;
    }

    struct LocalSalePolicy {
        address oracleRegistry;
        bytes32 priceId;
        uint16 minimumPriceBps;
        uint8 collateralDecimals;
        uint8 settlementDecimals;
        uint128 maxCollateralPerSale;
        bytes32 collateralCodeHash;
        bytes32 settlementCodeHash;
        bytes32 oracleCodeHash;
        bool active;
    }

    struct SolanaMarket {
        bytes32 sourceGenesis;
        bytes32 programId;
        bytes32 sourceAsset;
        bytes32 recoveryVault;
        bool active;
    }

    struct SolanaIdentity {
        bytes32 sourceGenesis;
        bytes32 programId;
        bytes32 sourceAsset;
        bytes32 sourceOwner;
        bytes32 returnRecipient;
        bytes32 recoveryVault;
        uint64 verifierVersion;
    }

    struct RemoteSalePolicy {
        address oracleRegistry;
        bytes32 priceId;
        uint16 minimumPriceBps;
        uint8 collateralDecimals;
        uint8 settlementDecimals;
        uint128 maxCollateralPerRoute;
        bytes32 settlementCodeHash;
        bytes32 oracleCodeHash;
        bool active;
    }

    address public governance;
    address public guardian;
    address public riskEngine;
    address public integrationRegistry;
    address public verifierRegistry;
    address public houseRegistry;
    address public healthSource;
    bytes32 public immutable domain;
    bool public paused;
    uint256 public acceptedCredits;
    bool private entered;
    mapping(bytes32 => Credit) internal _credits;
    mapping(address => bool) public vaultEverUsed;
    mapping(bytes32 => address) public exitVerifierOfBundle;
    mapping(bytes32 => bytes32) public exitVerifierCodeHash;
    mapping(bytes32 => bool) public bundleEverUsed;
    mapping(bytes32 => bool) public intentUsed;
    mapping(address => mapping(uint256 => bool)) public houseNonces;
    mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;
    mapping(bytes32 => mapping(bytes32 => bool)) public lockBound;
    mapping(bytes32 => mapping(bytes32 => bool)) public lockReturned;
    mapping(address => mapping(bytes4 => bool)) public approvedCalls;
    mapping(bytes32 => mapping(address => uint256)) public sessionLimits;
    mapping(bytes32 => mapping(address => uint256)) public sessionExpiry;
    mapping(bytes32 => mapping(address => uint256)) public sessionNonces;
    mapping(bytes32 => mapping(address => mapping(bytes32 => uint256))) public sessionCapabilityLimit;
    mapping(bytes32 => mapping(address => bytes32)) public sessionCapabilityOf;
    mapping(bytes32 => mapping(address => uint256)) public sessionTotalLimit;
    mapping(bytes32 => mapping(address => uint256)) public sessionSpent;
    mapping(bytes32 => uint256) public sessionGeneration;
    mapping(bytes32 => mapping(address => uint256)) public sessionGenerationAt;
    mapping(bytes32 => bool) public collateralProven;
    mapping(bytes32 => address) public collateralOwnerOf;
    mapping(bytes32 => uint256) public collateralSourceChainOf;
    mapping(bytes32 => bool) public remoteCollateral;
    mapping(bytes32 => bool) public bondSettled;
    mapping(bytes32 => uint256) public pendingRemoteReturn;
    mapping(bytes32 => uint256) public pendingRemoteSeizure;
    mapping(bytes32 => uint256) public remoteActionNonce;
    mapping(bytes32 => bytes32) public remoteReturnActionHash;
    mapping(bytes32 => uint256) public remoteReturnDeadline;
    mapping(bytes32 => bytes32) public remoteSeizureActionHash;
    mapping(bytes32 => address) public remoteSeizureRecipient;
    mapping(bytes32 => uint256) public remoteSeizureDeadline;
    mapping(bytes32 => bool) public remoteSeizureConfirmed;
    mapping(uint256 => mapping(address => address)) public sourceCollateralVault;
    mapping(uint256 => mapping(address => address)) public sourceRecoveryVault;
    mapping(bytes32 => address) public remoteRecoveryVaultOf;
    mapping(address => bool) public recoveryKeepers;
    mapping(bytes32 => uint256) public healthSnapshotAt;
    mapping(bytes32 => uint256) public healthSnapshotRevision;
    mapping(bytes32 => LocalSalePolicy) public localSalePolicies;
    mapping(bytes32 => RemoteSalePolicy) public remoteSalePolicies;
    mapping(address => bytes32) public localCollateralVaultCodeHash;
    mapping(uint256 => SolanaMarket) public solanaMarkets;
    mapping(bytes32 => SolanaIdentity) public solanaIdentityOf;
    mapping(bytes32 => bool) public solanaCollateral;
    mapping(bytes32 => bytes32) public solanaLockPdaOf;
    uint256 public healthMaxAge = 1 days;

    event RemoteActionAuthorized(bytes32 indexed creditId, bytes32 indexed actionHash, uint8 kind);
    event RemoteSeizureConfirmed(bytes32 indexed creditId, bytes32 indexed actionHash, uint256 amount);
    event RemoteSeizureCancelled(bytes32 indexed creditId, bytes32 indexed actionHash);
    event RemoteReturnCancelled(bytes32 indexed creditId, bytes32 indexed actionHash);
    event SourceRecoveryReturnAuthorized(
        bytes32 indexed creditId, bytes32 indexed actionHash, address indexed owner,
        uint256 amount, uint256 nonce, uint256 deadline
    );
    event LocalSalePolicySet(bytes32 indexed marketId, address indexed collateralAsset, address indexed settlementAsset);
    event LocalSalePolicyDisabled(bytes32 indexed marketId);
    event LocalCollateralVaultSet(address indexed vault, address indexed asset, bytes32 codeHash);
    event LocalCollateralSold(bytes32 indexed creditId, address indexed buyer, uint256 collateralAmount, uint256 settlementAmount);
    event SolanaMarketSet(uint256 indexed sourceChain, bytes32 indexed sourceGenesis, bytes32 programId);
    event RemoteSalePolicySet(bytes32 indexed marketId, uint256 indexed sourceChain, address indexed collateralAsset);
    event RemoteSalePolicyDisabled(bytes32 indexed marketId);

    error Expired();
    error Unauthorized();
    error BadState();
    error OverLimit();
    error Frozen();
    error Used();
    error BadSig();
    error BadHealth();
    error InvalidTerms();
    error InvalidVault();
    error InvalidAccount();
    error InvalidCollateral();
    error Pending();
    error RecoveryIncomplete();
    error InvalidAuthority();

    uint256 private constant BPS = 10_000;
    uint256 private constant MINIMUM_SALE_PRICE_BPS = 9_000;
    uint256 private constant YEAR = 365 days;
    bytes32 private constant SOLANA_ALIAS_DOMAIN = keccak256("Termbook Solana alias v1");
    bytes32 private constant SOLANA_QUOTE_DOMAIN = keccak256("Termbook Solana quote v1");
    bytes32 private constant SOLANA_LOCK_DOMAIN = keccak256("Termbook Solana lock v1");
    bytes32 private constant SOLANA_ACTION_DOMAIN = keccak256("Termbook Solana action v1");
    bytes32 private constant SOURCE_RECOVERY_RETURN_DOMAIN = keccak256("Termbook source recovery return v1");
    bytes32 public constant SOLANA_NATIVE_ASSET_ID = 0x0101010101010101010101010101010101010101010101010101010101010101;

    modifier nonReentrant() {
        if (entered) revert Frozen();
        entered = true;
        _;
        entered = false;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert Unauthorized();
        _;
    }

    constructor(address governance_, address guardian_, address risk_) {
        if (governance_ == address(0) || guardian_ == address(0)) revert Unauthorized();
        governance = governance_;
        guardian = guardian_;
        riskEngine = risk_;
        domain = keccak256(abi.encode("termbook-v1", block.chainid, address(this)));
    }

    function setGovernance(address governance_) external onlyGovernance {
        if (governance_ == address(0) || governance_.code.length == 0) revert InvalidAuthority();
        governance = governance_;
    }

    function setGuardian(address guardian_) external onlyGovernance {
        if (guardian_ == address(0) || guardian_.code.length == 0) revert InvalidAuthority();
        guardian = guardian_;
    }

    function setCollateralPauseGuardian(address collateralVault, address pauseGuardian) external onlyGovernance {
        if (collateralVault == address(0) || pauseGuardian == address(0) || pauseGuardian.code.length == 0) {
            revert InvalidAuthority();
        }
        if (ICollateralVaultCore(collateralVault).core() != address(this)) revert InvalidCollateral();
        ICollateralVaultCore(collateralVault).setPauseGuardian(pauseGuardian);
    }

    function setLocalCollateralVault(address vault, bytes32 codeHash) external onlyGovernance {
        if (vault == address(0)) revert InvalidCollateral();
        if (codeHash == bytes32(0)) {
            if (localCollateralVaultCodeHash[vault] == bytes32(0)) revert InvalidCollateral();
            localCollateralVaultCodeHash[vault] = bytes32(0);
            emit LocalCollateralVaultSet(vault, address(0), bytes32(0));
            return;
        }
        if (vault.codehash != codeHash) revert InvalidCollateral();
        address vaultAsset = _localCollateralVaultAsset(vault, codeHash);
        localCollateralVaultCodeHash[vault] = codeHash;
        emit LocalCollateralVaultSet(vault, vaultAsset, codeHash);
    }

    function _localCollateralVaultAsset(address vault, bytes32 codeHash) internal view returns (address vaultAsset) {
        if (
            codeHash == bytes32(0) || vault.code.length == 0 || vault.codehash != codeHash
                || ICollateralVaultCore(vault).core() != address(this)
                || ICollateralVaultCore(vault).chainId_() != block.chainid
        ) revert InvalidCollateral();
        vaultAsset = ICollateralVaultCore(vault).asset();
        if (vaultAsset == address(0) || vaultAsset.code.length == 0) revert InvalidCollateral();
    }

    function _requireLocalCollateralVault(address vault) internal view returns (address vaultAsset) {
        vaultAsset = _localCollateralVaultAsset(vault, localCollateralVaultCodeHash[vault]);
    }

    function setHouseRegistry(address registry) external onlyGovernance {
        if (acceptedCredits != 0) revert Frozen();
        if (registry == address(0) || registry.code.length == 0) revert InvalidAuthority();
        houseRegistry = registry;
    }

    function setHouseProtocolFee(address vault, address recipient, uint256 feeBps) external onlyGovernance {
        if (vaultEverUsed[vault]) revert Frozen();
        if (vault == address(0) || vault.code.length == 0 || feeBps > BPS) revert InvalidTerms();
        if (feeBps > 0 && recipient == address(0)) revert InvalidTerms();
        (bool ok, bytes memory data) = vault.staticcall(abi.encodeWithSelector(IHouseVaultCore.core.selector));
        if (!ok || data.length < 32 || abi.decode(data, (address)) != address(this)) revert InvalidVault();
        IHouseVaultCore(vault).setProtocolFee(recipient, feeBps);
    }

    function setRecoveryKeeper(address keeper, bool active) external onlyGovernance {
        if (keeper == address(0)) revert InvalidAuthority();
        recoveryKeepers[keeper] = active;
    }

    function localSaleMarketId(address collateralAsset, address settlementAsset) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, collateralAsset, settlementAsset));
    }

    function setLocalSalePolicy(
        address collateralAsset,
        address settlementAsset,
        address oracleRegistry,
        bytes32 priceId,
        uint16 minimumPriceBps,
        uint128 maxCollateralPerSale
    ) external onlyGovernance {
        bytes32 marketId = localSaleMarketId(collateralAsset, settlementAsset);
        if (
            collateralAsset == settlementAsset || collateralAsset.code.length == 0 || settlementAsset.code.length == 0
                || oracleRegistry.code.length == 0 || priceId == bytes32(0)
                || minimumPriceBps < MINIMUM_SALE_PRICE_BPS || minimumPriceBps > BPS
                || maxCollateralPerSale == 0 || localSalePolicies[marketId].oracleRegistry != address(0)
        ) revert InvalidCollateral();
        uint8 collateralDecimals = _tokenDecimals(collateralAsset);
        uint8 settlementDecimals = _tokenDecimals(settlementAsset);
        if (collateralDecimals > 18 || settlementDecimals > 18) revert InvalidCollateral();
        (uint256 price,,) = IOracleRegistrySaleCore(oracleRegistry).read(priceId);
        if (price == 0 || price > type(uint128).max) revert InvalidCollateral();
        localSalePolicies[marketId] = LocalSalePolicy({
            oracleRegistry: oracleRegistry,
            priceId: priceId,
            minimumPriceBps: minimumPriceBps,
            collateralDecimals: collateralDecimals,
            settlementDecimals: settlementDecimals,
            maxCollateralPerSale: maxCollateralPerSale,
            collateralCodeHash: collateralAsset.codehash,
            settlementCodeHash: settlementAsset.codehash,
            oracleCodeHash: oracleRegistry.codehash,
            active: true
        });
        emit LocalSalePolicySet(marketId, collateralAsset, settlementAsset);
    }

    function disableLocalSalePolicy(address collateralAsset, address settlementAsset) external onlyGovernance {
        bytes32 marketId = localSaleMarketId(collateralAsset, settlementAsset);
        LocalSalePolicy storage policy = localSalePolicies[marketId];
        if (!policy.active) revert InvalidCollateral();
        policy.active = false;
        emit LocalSalePolicyDisabled(marketId);
    }

    function remoteSaleMarketId(uint256 sourceChain, address collateralAsset, address settlementAsset)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(sourceChain, collateralAsset, settlementAsset));
    }

    function setRemoteSalePolicy(
        uint256 sourceChain,
        address collateralAsset,
        address settlementAsset,
        address oracleRegistry,
        bytes32 priceId,
        uint8 collateralDecimals,
        uint16 minimumPriceBps,
        uint128 maxCollateralPerRoute
    ) external onlyGovernance {
        bytes32 marketId = remoteSaleMarketId(sourceChain, collateralAsset, settlementAsset);
        if (
            sourceChain == 0 || sourceChain == block.chainid || collateralAsset == address(0)
                || sourceCollateralVault[sourceChain][collateralAsset] == address(0)
                || sourceRecoveryVault[sourceChain][collateralAsset] == address(0)
                || settlementAsset.code.length == 0 || oracleRegistry.code.length == 0 || priceId == bytes32(0)
                || collateralDecimals > 18 || minimumPriceBps < MINIMUM_SALE_PRICE_BPS
                || minimumPriceBps > BPS || maxCollateralPerRoute == 0
                || remoteSalePolicies[marketId].active
        ) revert InvalidCollateral();
        uint8 settlementDecimals = _tokenDecimals(settlementAsset);
        if (settlementDecimals > 18) revert InvalidCollateral();
        (uint256 price,,) = IOracleRegistrySaleCore(oracleRegistry).read(priceId);
        if (price == 0 || price > type(uint128).max) revert InvalidCollateral();
        remoteSalePolicies[marketId] = RemoteSalePolicy({
            oracleRegistry: oracleRegistry,
            priceId: priceId,
            minimumPriceBps: minimumPriceBps,
            collateralDecimals: collateralDecimals,
            settlementDecimals: settlementDecimals,
            maxCollateralPerRoute: maxCollateralPerRoute,
            settlementCodeHash: settlementAsset.codehash,
            oracleCodeHash: oracleRegistry.codehash,
            active: true
        });
        emit RemoteSalePolicySet(marketId, sourceChain, collateralAsset);
    }

    function disableRemoteSalePolicy(uint256 sourceChain, address collateralAsset, address settlementAsset)
        external
        onlyGovernance
    {
        bytes32 marketId = remoteSaleMarketId(sourceChain, collateralAsset, settlementAsset);
        if (!remoteSalePolicies[marketId].active) revert InvalidCollateral();
        remoteSalePolicies[marketId].active = false;
        emit RemoteSalePolicyDisabled(marketId);
    }

    function _requireRemoteSalePolicy(uint256 sourceChain, address collateralAsset, address settlementAsset)
        internal
        view
        returns (uint256 price)
    {
        RemoteSalePolicy storage policy =
            remoteSalePolicies[remoteSaleMarketId(sourceChain, collateralAsset, settlementAsset)];
        if (
            !policy.active || policy.oracleRegistry.code.length == 0
                || policy.oracleRegistry.codehash != policy.oracleCodeHash
                || settlementAsset.codehash != policy.settlementCodeHash
                || _tokenDecimals(settlementAsset) != policy.settlementDecimals
                || policy.priceId == bytes32(0) || policy.maxCollateralPerRoute == 0
        ) revert InvalidCollateral();
        try IOracleRegistrySaleCore(policy.oracleRegistry).read(policy.priceId) returns (
            uint256 value, uint256 updatedAt, uint80 roundId
        ) {
            if (value == 0 || value > type(uint128).max || updatedAt == 0 || updatedAt > block.timestamp || roundId == 0)
            {
                revert InvalidCollateral();
            }
            price = value;
        } catch {
            revert InvalidCollateral();
        }
    }

    function minimumRemoteRecoveryProceeds(bytes32 creditId, uint256 collateralAmount)
        external
        view
        returns (uint256)
    {
        Credit storage c = _credits[creditId];
        if (!remoteCollateral[creditId] || collateralAmount == 0 || c.vault == address(0)) {
            revert InvalidCollateral();
        }
        address settlementAsset = IHouseVaultCore(c.vault).asset();
        RemoteSalePolicy storage policy = remoteSalePolicies[
            remoteSaleMarketId(collateralSourceChainOf[creditId], c.collateralAsset, settlementAsset)
        ];
        if (collateralAmount > policy.maxCollateralPerRoute) revert InvalidCollateral();
        uint256 price = _requireRemoteSalePolicy(collateralSourceChainOf[creditId], c.collateralAsset, settlementAsset);
        uint256 fairValue = _mulDivUp(collateralAmount, price, 10 ** policy.collateralDecimals);
        uint256 fairSettlement = _mulDivUp(fairValue, 10 ** policy.settlementDecimals, 1e18);
        return _mulDivUp(fairSettlement, policy.minimumPriceBps, BPS);
    }

    function _tokenDecimals(address token) internal view returns (uint8 decimals_) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length < 32) revert InvalidCollateral();
        decimals_ = abi.decode(data, (uint8));
    }

    function _requireLocalSalePolicy(address collateralAsset, address settlementAsset)
        internal
        view
        returns (LocalSalePolicy memory policy, uint256 price)
    {
        policy = localSalePolicies[localSaleMarketId(collateralAsset, settlementAsset)];
        if (
            !policy.active || collateralAsset.codehash != policy.collateralCodeHash
                || settlementAsset.codehash != policy.settlementCodeHash
                || policy.oracleRegistry.codehash != policy.oracleCodeHash
                || _tokenDecimals(collateralAsset) != policy.collateralDecimals
                || _tokenDecimals(settlementAsset) != policy.settlementDecimals
        ) revert InvalidCollateral();
        (price,,) = IOracleRegistrySaleCore(policy.oracleRegistry).read(policy.priceId);
        if (price == 0 || price > type(uint128).max) revert InvalidCollateral();
    }

    function setSourceRecoveryVault(uint256 sourceChain, address asset, address recoveryVault) external onlyGovernance {
        if (sourceChain == 0 || sourceChain == block.chainid || asset == address(0) || recoveryVault == address(0)) {
            revert InvalidAuthority();
        }
        if (solanaMarkets[sourceChain].sourceGenesis != bytes32(0)) revert InvalidAuthority();
        sourceRecoveryVault[sourceChain][asset] = recoveryVault;
    }

    function setSourceCollateralVault(uint256 sourceChain, address asset, address collateralVault) external onlyGovernance {
        if (sourceChain == 0 || sourceChain == block.chainid || asset == address(0)) revert InvalidAuthority();
        if (solanaMarkets[sourceChain].sourceGenesis != bytes32(0)) revert InvalidAuthority();
        sourceCollateralVault[sourceChain][asset] = collateralVault;
    }

    function solanaAlias(bytes32 sourceGenesis, bytes32 identity) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(SOLANA_ALIAS_DOMAIN, sourceGenesis, identity)))));
    }

    function recoveryRefundRecipientOf(bytes32 creditId) external view returns (address) {
        return solanaCollateral[creditId] ? _credits[creditId].borrower : collateralOwnerOf[creditId];
    }

    function setSolanaMarket(
        uint256 sourceChain,
        bytes32 sourceGenesis,
        bytes32 programId,
        bytes32 recoveryVault
    ) external onlyGovernance {
        if (
            sourceChain == 0 || sourceChain == block.chainid || sourceGenesis == bytes32(0)
                || programId == bytes32(0) || recoveryVault == bytes32(0)
                || solanaMarkets[sourceChain].sourceGenesis != bytes32(0)
        ) revert InvalidAuthority();
        address assetAlias = solanaAlias(sourceGenesis, SOLANA_NATIVE_ASSET_ID);
        address vaultAlias = solanaAlias(sourceGenesis, programId);
        address recoveryAlias = solanaAlias(sourceGenesis, recoveryVault);
        if (
            sourceCollateralVault[sourceChain][assetAlias] != address(0)
                || sourceRecoveryVault[sourceChain][assetAlias] != address(0)
        ) revert InvalidAuthority();
        solanaMarkets[sourceChain] = SolanaMarket(
            sourceGenesis, programId, SOLANA_NATIVE_ASSET_ID, recoveryVault, true
        );
        sourceCollateralVault[sourceChain][assetAlias] = vaultAlias;
        sourceRecoveryVault[sourceChain][assetAlias] = recoveryAlias;
        emit SolanaMarketSet(sourceChain, sourceGenesis, programId);
    }

    function disableSolanaMarket(uint256 sourceChain) external onlyGovernance {
        if (!solanaMarkets[sourceChain].active) revert InvalidAuthority();
        solanaMarkets[sourceChain].active = false;
    }

    function setPaused(bool value) external {
        if (msg.sender != guardian && msg.sender != governance) revert Unauthorized();
        paused = value;
    }

    function setRisk(address risk) external onlyGovernance {
        if (acceptedCredits != 0 || risk == address(0) || risk.code.length == 0) revert InvalidTerms();
        riskEngine = risk;
    }

    function setHealthSource(address source) external onlyGovernance {
        if (acceptedCredits != 0) revert Frozen();
        if (source == address(0) || source.code.length == 0) revert InvalidTerms();
        healthSource = source;
    }

    function setHealthMaxAge(uint256 maxAge) external onlyGovernance {
        if (maxAge == 0 || (acceptedCredits != 0 && maxAge > healthMaxAge)) revert InvalidTerms();
        healthMaxAge = maxAge;
    }

    function setIntegrationRegistry(address registry) external onlyGovernance {
        if (acceptedCredits != 0) revert Frozen();
        if (registry == address(0) || registry.code.length == 0) revert InvalidTerms();
        integrationRegistry = registry;
    }

    function setExitVerifier(bytes32 bundleId, address verifier) external onlyGovernance {
        if (
            bundleId == bytes32(0) || bundleEverUsed[bundleId] || exitVerifierOfBundle[bundleId] != address(0)
                || verifier.code.length == 0
        ) revert InvalidTerms();
        exitVerifierOfBundle[bundleId] = verifier;
        exitVerifierCodeHash[bundleId] = verifier.codehash;
    }

    function setVerifierRegistry(address registry) external onlyGovernance {
        if (acceptedCredits != 0) revert Frozen();
        if (registry == address(0) || registry.code.length == 0) revert InvalidTerms();
        verifierRegistry = registry;
    }

    function setApprovedCall(address target, bytes4 selector, bool active) external onlyGovernance {
        if (acceptedCredits != 0) revert Frozen();
        if (target == address(0) || target.code.length == 0 || selector == bytes4(0)) revert InvalidTerms();
        approvedCalls[target][selector] = active;
    }

    function configureRisk(
        bytes32 creditId,
        uint256 initial_,
        uint256 maintenance_,
        uint256 watch_,
        uint256 freeze_,
        uint256 liquidation_
    ) external onlyGovernance {
        if (riskEngine == address(0)) revert InvalidTerms();
        IRiskCore(riskEngine).setRiskBands(creditId, initial_, maintenance_, watch_, freeze_, liquidation_);
    }

    function recordHealth(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        _accrue(c, creditId);
        if (healthSource == address(0) || riskEngine == address(0)) revert BadHealth();
        Types.HealthSnapshot memory snapshot_ = IHealthSourceCore(healthSource).snapshot(
            creditId,
            c.bundleId,
            c.revision,
            c.debt
        );
        if (snapshot_.debt != c.debt) revert BadHealth();
        IRiskCore(riskEngine).record(creditId, snapshot_);
        healthSnapshotAt[creditId] = block.timestamp;
        healthSnapshotRevision[creditId] = c.revision;
    }

    function healthSnapshot(bytes32 creditId) external view returns (Types.HealthSnapshot memory) {
        if (riskEngine == address(0)) revert BadHealth();
        return IRiskCore(riskEngine).snapshot(creditId);
    }

    function quoteDigest(
        bytes32 intentId,
        address borrower,
        address house,
        address vault,
        uint256 limit,
        uint256 maturity,
        bool revolving,
        bytes32 bundleId,
        uint256 setupDeadline,
        uint256 grace,
        uint256 reservationBond,
        uint256 nonce,
        uint256 expiry,
        bytes32 termsHash
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                domain,
                intentId,
                borrower,
                house,
                vault,
                limit,
                maturity,
                revolving,
                bundleId,
                setupDeadline,
                grace,
                reservationBond,
                nonce,
                expiry,
                termsHash
            )
        );
    }

    function quoteDigestFull(Types.Quote calldata quote) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                domain,
                quote.intentId,
                quote.borrower,
                quote.owner,
                quote.house,
                quote.vault,
                quote.sourceChain,
                quote.collateralVault,
                quote.collateralAsset,
                quote.collateralAmount,
                quote.returnRecipient,
                quote.settlementAsset,
                quote.limit,
                quote.maturity,
                quote.revolving,
                quote.bundleId,
                quote.setupDeadline,
                quote.gracePeriod,
                quote.reservationBond,
                quote.nonce,
                quote.expiry,
                quote.termsHash,
                quote.aprBps,
                quote.originationFee,
                quote.commitmentFeeBps
            )
        );
    }

    function solanaQuoteDigest(Types.SolanaQuote calldata quote) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                SOLANA_QUOTE_DOMAIN,
                quoteDigestFull(quote.quote),
                quote.sourceGenesis,
                quote.sourceVault,
                quote.sourceAsset,
                quote.sourceOwner,
                quote.returnRecipient,
                quote.recoveryVault,
                quote.verifierVersion
            )
        );
    }

    function quoteDigestWithTerms(
        bytes32 intentId,
        address borrower,
        address house,
        address vault,
        uint256 limit,
        uint256 maturity,
        bool revolving,
        bytes32 bundleId,
        uint256 setupDeadline,
        uint256 grace,
        uint256 reservationBond,
        uint256 nonce,
        uint256 expiry,
        bytes32 termsHash,
        uint256 aprBps,
        uint256 originationFee,
        uint256 commitmentFeeBps
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                domain,
                intentId,
                borrower,
                house,
                vault,
                limit,
                maturity,
                revolving,
                bundleId,
                setupDeadline,
                grace,
                reservationBond,
                nonce,
                expiry,
                termsHash,
                aprBps,
                originationFee,
                commitmentFeeBps
            )
        );
    }

    function accept(
        bytes32 creditId,
        bytes32 intentId,
        address borrower,
        address house,
        address vault,
        uint256 limit,
        uint256 maturity,
        bool revolving,
        bytes32 bundleId,
        uint256 setupDeadline,
        uint256 grace,
        bytes32 termsHash,
        uint256 houseNonce,
        uint256 expiry,
        bytes calldata houseSig
    ) external nonReentrant {
        AcceptParams memory p = AcceptParams(
            creditId,
            intentId,
            borrower,
            house,
            vault,
            limit,
            maturity,
            revolving,
            bundleId,
            setupDeadline,
            grace,
            0,
            termsHash,
            houseNonce,
            expiry,
            houseSig,
            0,
            0,
            0
        );
        _accept(p, false, false);
    }

    function acceptWithBond(
        bytes32 creditId,
        bytes32 intentId,
        address borrower,
        address house,
        address vault,
        uint256 limit,
        uint256 maturity,
        bool revolving,
        bytes32 bundleId,
        uint256 setupDeadline,
        uint256 grace,
        uint256 reservationBond,
        bytes32 termsHash,
        uint256 houseNonce,
        uint256 expiry,
        bytes calldata houseSig
    ) external nonReentrant {
        AcceptParams memory p = AcceptParams(
            creditId,
            intentId,
            borrower,
            house,
            vault,
            limit,
            maturity,
            revolving,
            bundleId,
            setupDeadline,
            grace,
            reservationBond,
            termsHash,
            houseNonce,
            expiry,
            houseSig,
            0,
            0,
            0
        );
        _accept(p, false, false);
    }

    function acceptWithTerms(
        bytes32 creditId,
        bytes32 intentId,
        address borrower,
        address house,
        address vault,
        uint256 limit,
        uint256 maturity,
        bool revolving,
        bytes32 bundleId,
        uint256 setupDeadline,
        uint256 grace,
        uint256 termsReservationBond,
        bytes32 termsHash,
        uint256 houseNonce,
        uint256 expiry,
        uint256 aprBps,
        uint256 originationFee,
        uint256 commitmentFeeBps,
        bytes calldata houseSig
    ) external nonReentrant {
        AcceptParams memory p = AcceptParams(
            creditId,
            intentId,
            borrower,
            house,
            vault,
            limit,
            maturity,
            revolving,
            bundleId,
            setupDeadline,
            grace,
            termsReservationBond,
            termsHash,
            houseNonce,
            expiry,
            houseSig,
            aprBps,
            originationFee,
            commitmentFeeBps
        );
        _accept(p, false, true);
    }

    function acceptQuote(Types.Quote calldata quote) external nonReentrant {
        AcceptParams memory p = AcceptParams(
            keccak256(abi.encode(quote.intentId, quote.borrower, quote.house, quote.nonce)),
            quote.intentId,
            quote.borrower,
            quote.house,
            quote.vault,
            quote.limit,
            quote.maturity,
            quote.revolving,
            quote.bundleId,
            quote.setupDeadline,
            quote.gracePeriod,
            quote.reservationBond,
            quote.termsHash,
            quote.nonce,
            quote.expiry,
            quote.signature,
            quote.aprBps,
            quote.originationFee,
            quote.commitmentFeeBps
        );
        if (quote.settlementAsset != address(0) && quote.settlementAsset != _vaultAsset(quote.vault)) {
            revert InvalidVault();
        }
        bytes32 fullDigest = quoteDigestFull(quote);
        if (!AuthLib.verify(fullDigest, quote.signature, quote.house)) revert BadSig();
        _accept(p, true, false);
        if (quote.collateralVault != address(0)) {
            if (
                quote.owner == address(0) || quote.collateralAsset == address(0) || quote.collateralAmount == 0
                    || quote.returnRecipient == address(0) || quote.sourceChain == 0
            ) revert InvalidCollateral();
            _setQuotedCollateral(
                p.creditId,
                quote.owner,
                quote.sourceChain,
                quote.collateralVault,
                quote.collateralAsset,
                quote.collateralAmount,
                quote.returnRecipient
            );
        }
    }

    function acceptSolanaQuote(Types.SolanaQuote calldata solana) external nonReentrant {
        Types.Quote calldata quote = solana.quote;
        SolanaMarket storage market = solanaMarkets[quote.sourceChain];
        if (
            !market.active || market.sourceGenesis != solana.sourceGenesis
                || market.programId != solana.sourceVault || market.sourceAsset != solana.sourceAsset
                || market.recoveryVault != solana.recoveryVault || solana.sourceOwner == bytes32(0)
                || solana.returnRecipient == bytes32(0) || solana.verifierVersion == 0
                || quote.collateralAmount == 0 || quote.collateralAmount > type(uint64).max
                || quote.setupDeadline > uint256(uint64(type(int64).max))
                || block.chainid > type(uint64).max
                || quote.collateralVault != solanaAlias(solana.sourceGenesis, solana.sourceVault)
                || quote.collateralAsset != solanaAlias(solana.sourceGenesis, solana.sourceAsset)
                || quote.owner != solanaAlias(solana.sourceGenesis, solana.sourceOwner)
                || quote.returnRecipient != solanaAlias(solana.sourceGenesis, solana.returnRecipient)
                || quote.settlementAsset != _vaultAsset(quote.vault)
                || !AuthLib.verify(solanaQuoteDigest(solana), quote.signature, quote.house)
        ) revert InvalidCollateral();
        bytes32 creditId = keccak256(abi.encode(quote.intentId, quote.borrower, quote.house, quote.nonce));
        AcceptParams memory p = AcceptParams(
            creditId,
            quote.intentId,
            quote.borrower,
            quote.house,
            quote.vault,
            quote.limit,
            quote.maturity,
            quote.revolving,
            quote.bundleId,
            quote.setupDeadline,
            quote.gracePeriod,
            quote.reservationBond,
            quote.termsHash,
            quote.nonce,
            quote.expiry,
            quote.signature,
            quote.aprBps,
            quote.originationFee,
            quote.commitmentFeeBps
        );
        _accept(p, true, false);
        solanaCollateral[creditId] = true;
        _setQuotedCollateral(
            creditId,
            quote.owner,
            quote.sourceChain,
            quote.collateralVault,
            quote.collateralAsset,
            quote.collateralAmount,
            quote.returnRecipient
        );
        if (_credits[creditId].verifierVersion != solana.verifierVersion) revert InvalidCollateral();
        solanaIdentityOf[creditId] = SolanaIdentity(
            solana.sourceGenesis,
            solana.sourceVault,
            solana.sourceAsset,
            solana.sourceOwner,
            solana.returnRecipient,
            solana.recoveryVault,
            solana.verifierVersion
        );
    }

    function _accept(AcceptParams memory p, bool fullDigest, bool termsDigest) internal {
        if (paused) revert Frozen();
        if (msg.sender != p.borrower) revert Unauthorized();
        if (intentUsed[p.intentId] || _credits[p.creditId].revision != 0 || houseNonces[p.house][p.houseNonce]) {
            revert Used();
        }
        if (p.borrower == address(0) || p.house == address(0) || p.vault.code.length == 0 || p.limit == 0) {
            revert InvalidTerms();
        }
        if (p.aprBps > 1_000_000 || p.commitmentFeeBps > BPS || p.originationFee > p.limit) revert InvalidTerms();
        if (block.timestamp > p.setupDeadline || block.timestamp > p.expiry || p.maturity <= p.setupDeadline) {
            revert Expired();
        }
        if (_vaultCore(p.vault) != address(this)) revert InvalidVault();
        _vaultAsset(p.vault);
        uint256 policyVersion;
        uint256 initialBps;
        uint256 maintenanceBps;
        uint256 watchBps;
        uint256 freezeBps;
        uint256 liquidationBps;
        if (houseRegistry != address(0)) {
            if (!IHouseRegistryCore(houseRegistry).isActiveHouse(p.house, p.vault)) revert InvalidVault();
            uint256 maxLimit;
            uint256 minMaturity;
            uint256 maxMaturity;
            uint256 maxAprBps;
            uint256 maxOriginationFeeBps;
            uint256 maxCommitmentFeeBps;
            bool riskConfigured;
            bool active;
            (
                policyVersion,
                maxLimit,
                minMaturity,
                maxMaturity,
                maxAprBps,
                maxOriginationFeeBps,
                maxCommitmentFeeBps,
                initialBps,
                maintenanceBps,
                watchBps,
                freezeBps,
                liquidationBps,
                riskConfigured,
                active
            ) = IHouseRegistryCore(houseRegistry).policies(p.house);
            if (
                !active || !riskConfigured || p.limit > maxLimit || p.maturity - p.setupDeadline < minMaturity
                    || p.maturity - p.setupDeadline > maxMaturity || p.aprBps > maxAprBps
                    || p.commitmentFeeBps > maxCommitmentFeeBps
                    || p.originationFee > p.limit * maxOriginationFeeBps / BPS
            ) revert InvalidTerms();
        }
        if (!fullDigest) {
            bytes32 digest = termsDigest
                ? quoteDigestWithTerms(
                    p.intentId,
                    p.borrower,
                    p.house,
                    p.vault,
                    p.limit,
                    p.maturity,
                    p.revolving,
                    p.bundleId,
                    p.setupDeadline,
                    p.grace,
                    p.reservationBond,
                    p.houseNonce,
                    p.expiry,
                    p.termsHash,
                    p.aprBps,
                    p.originationFee,
                    p.commitmentFeeBps
                )
                : quoteDigest(
                    p.intentId,
                    p.borrower,
                    p.house,
                    p.vault,
                    p.limit,
                    p.maturity,
                    p.revolving,
                    p.bundleId,
                    p.setupDeadline,
                    p.grace,
                    p.reservationBond,
                    p.houseNonce,
                    p.expiry,
                    p.termsHash
                );
            if (!AuthLib.verify(digest, p.houseSig, p.house)) revert BadSig();
        }
        intentUsed[p.intentId] = true;
        if (integrationRegistry != address(0) && exitVerifierOfBundle[p.bundleId] == address(0)) {
            revert InvalidTerms();
        }
        bundleEverUsed[p.bundleId] = true;
        houseNonces[p.house][p.houseNonce] = true;
        IHouseVaultCore(p.vault).reserve(p.creditId, p.limit);
        vaultEverUsed[p.vault] = true;
        if (p.reservationBond > 0) IHouseVaultCore(p.vault).collectBond(p.creditId, p.borrower, p.reservationBond);
        Credit storage c = _credits[p.creditId];
        c.facility = Types.Facility.Reserved;
        c.payment = Types.Payment.Undrawn;
        c.borrower = p.borrower;
        c.house = p.house;
        c.vault = p.vault;
        c.limit = p.limit;
        c.maturity = p.maturity;
        c.grace = p.grace;
        c.setupDeadline = p.setupDeadline;
        c.reservationBond = p.reservationBond;
        c.revolving = p.revolving;
        c.bundleId = p.bundleId;
        c.termsHash = p.termsHash;
        c.aprBps = p.aprBps;
        c.originationFee = p.originationFee;
        c.commitmentFeeBps = p.commitmentFeeBps;
        c.policyVersion = policyVersion;
        c.accruedAt = block.timestamp;
        c.revision = 1;
        if (houseRegistry != address(0)) {
            if (riskEngine == address(0)) revert InvalidTerms();
            IRiskCore(riskEngine)
                .setRiskBands(p.creditId, initialBps, maintenanceBps, watchBps, freezeBps, liquidationBps);
        }
        acceptedCredits += 1;
        emit Events.CreditCreated(p.creditId, p.intentId, p.borrower, p.house);
    }

    function _vaultCore(address vault) internal view returns (address result) {
        if (vault.code.length == 0) revert InvalidVault();
        (bool ok, bytes memory data) = vault.staticcall(abi.encodeWithSelector(IHouseVaultCore.core.selector));
        if (!ok || data.length < 32) revert InvalidVault();
        result = abi.decode(data, (address));
    }

    function _vaultAsset(address vault) internal view returns (address result) {
        if (vault.code.length == 0) revert InvalidVault();
        (bool ok, bytes memory data) = vault.staticcall(abi.encodeWithSelector(IHouseVaultCore.asset.selector));
        if (!ok || data.length < 32) revert InvalidVault();
        result = abi.decode(data, (address));
        if (result == address(0) || result.code.length == 0) revert InvalidVault();
    }

    function _pinVerifier(Credit storage c, uint256 sourceChain) internal {
        if (verifierRegistry == address(0)) revert InvalidCollateral();
        (address impl, uint256 version, bool active,, bytes32 codeHash) =
            IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (!active || impl.code.length == 0 || version == 0) revert InvalidCollateral();
        c.verifierVersion = version;
        c.verifierCodeHash = codeHash;
    }

    function _pinRemoteRecovery(bytes32 creditId, uint256 sourceChain, address collateralAsset) internal {
        address recoveryVault = sourceRecoveryVault[sourceChain][collateralAsset];
        if (recoveryVault == address(0)) revert InvalidCollateral();
        remoteRecoveryVaultOf[creditId] = recoveryVault;
    }

    function _setQuotedCollateral(
        bytes32 creditId,
        address owner,
        uint256 sourceChain,
        address collateralVault,
        address collateralAsset,
        uint256 collateralAmount,
        address returnRecipient
    ) internal {
        Credit storage c = _credits[creditId];
        bool remote = sourceChain != block.chainid;
        if (
            collateralVault == address(0) || collateralAsset == address(0)
                || (solanaMarkets[sourceChain].sourceGenesis != bytes32(0) && !solanaCollateral[creditId])
                || (remote && sourceCollateralVault[sourceChain][collateralAsset] != collateralVault)
                || (!remote && _requireLocalCollateralVault(collateralVault) != collateralAsset)
        ) revert InvalidCollateral();
        if (!remote && collateralAsset != IHouseVaultCore(c.vault).asset()) {
            _requireLocalSalePolicy(collateralAsset, IHouseVaultCore(c.vault).asset());
        }
        collateralOwnerOf[creditId] = owner;
        collateralSourceChainOf[creditId] = sourceChain;
        c.collateralVault = collateralVault;
        c.collateralAsset = collateralAsset;
        c.collateralAmount = collateralAmount;
        c.returnRecipient = returnRecipient;
        remoteCollateral[creditId] = remote;
        if (remote) {
            _requireRemoteSalePolicy(sourceChain, collateralAsset, IHouseVaultCore(c.vault).asset());
            _pinVerifier(c, sourceChain);
            _pinRemoteRecovery(creditId, sourceChain, collateralAsset);
        }
        c.facility = Types.Facility.CollateralLocking;
        c.revision = RevisionLib.next(c.revision);
    }

    function _settleBond(Credit storage c, bytes32 creditId) internal {
        if (!bondSettled[creditId] && c.reservationBond > 0) {
            IHouseVaultCore(c.vault).settleBond(creditId, c.reservationBond);
            bondSettled[creditId] = true;
        }
    }

    function setCollateral(bytes32 creditId, address collateralVault, address returnRecipient) external {
        _setCollateral(creditId, msg.sender, returnRecipient, collateralVault, returnRecipient, false, 0);
    }

    function setCollateralWithOwner(bytes32 creditId, address collateralVault, address owner, address returnRecipient)
        external
    {
        _setCollateral(creditId, msg.sender, returnRecipient, collateralVault, owner, false, 0);
    }

    function setRemoteCollateral(
        bytes32 creditId,
        uint256 sourceChain,
        address collateralVault,
        address collateralAsset,
        uint256 collateralAmount,
        address owner,
        address returnRecipient
    ) external {
        if (solanaMarkets[sourceChain].sourceGenesis != bytes32(0)) revert InvalidCollateral();
        if (sourceCollateralVault[sourceChain][collateralAsset] != collateralVault) revert InvalidCollateral();
        _setCollateral(creditId, msg.sender, returnRecipient, collateralVault, owner, true, sourceChain);
        if (sourceChain == 0 || sourceChain == block.chainid || collateralAsset == address(0) || collateralAmount == 0) revert InvalidCollateral();
        Credit storage c = _credits[creditId];
        c.collateralAsset = collateralAsset;
        c.collateralAmount = collateralAmount;
        _requireRemoteSalePolicy(sourceChain, collateralAsset, IHouseVaultCore(c.vault).asset());
        _pinRemoteRecovery(creditId, sourceChain, collateralAsset);
    }

    function _setCollateral(
        bytes32 creditId,
        address caller,
        address returnRecipient,
        address collateralVault,
        address owner,
        bool remote,
        uint256 sourceChain
    ) internal {
        Credit storage c = _credits[creditId];
        if (caller != c.borrower || c.facility != Types.Facility.Reserved) revert Unauthorized();
        if (collateralVault == address(0) || owner == address(0) || returnRecipient == address(0)) {
            revert InvalidCollateral();
        }
        if (!remote) {
            address collateralAsset = _requireLocalCollateralVault(collateralVault);
            sourceChain = block.chainid;
            address settlementAsset = IHouseVaultCore(c.vault).asset();
            if (collateralAsset != settlementAsset) _requireLocalSalePolicy(collateralAsset, settlementAsset);
            c.collateralAsset = collateralAsset;
        } else if (sourceChain == 0 || sourceChain == block.chainid) {
            revert InvalidCollateral();
        }
        c.collateralVault = collateralVault;
        c.returnRecipient = returnRecipient;
        collateralOwnerOf[creditId] = owner;
        collateralSourceChainOf[creditId] = sourceChain;
        remoteCollateral[creditId] = remote;
        if (remote) _pinVerifier(c, sourceChain);
        c.facility = Types.Facility.CollateralLocking;
        c.revision = RevisionLib.next(c.revision);
    }

    function bindRemoteCollateral(bytes32 creditId, bytes32 lockId) external {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower) revert Unauthorized();
        if (
            c.facility != Types.Facility.CollateralLocking || !remoteCollateral[creditId] || solanaCollateral[creditId]
                || c.collateralBound
                || lockId == bytes32(0)
        ) revert InvalidCollateral();
        c.lockId = lockId;
        c.collateralBound = true;
        c.facility = Types.Facility.CollateralProving;
        lockBound[creditId][lockId] = true;
        c.revision = RevisionLib.next(c.revision);
    }

    function bindSolanaCollateral(bytes32 creditId, bytes32 lockId, bytes32 lockPda) external {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower) revert Unauthorized();
        if (
            c.facility != Types.Facility.CollateralLocking || !solanaCollateral[creditId]
                || c.collateralBound || lockId == bytes32(0) || lockPda == bytes32(0)
        ) revert InvalidCollateral();
        c.lockId = lockId;
        solanaLockPdaOf[creditId] = lockPda;
        c.collateralBound = true;
        c.facility = Types.Facility.CollateralProving;
        lockBound[creditId][lockId] = true;
        c.revision = RevisionLib.next(c.revision);
    }

    function bindLateRemoteCollateral(
        bytes32 creditId,
        bytes32 lockId,
        uint256 sourceChain,
        address collateralVault,
        address collateralAsset,
        uint256 collateralAmount,
        address owner,
        address returnRecipient
    ) external {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower) revert Unauthorized();
        if (
            c.facility != Types.Facility.Aborted || c.collateralBound || lockId == bytes32(0) || sourceChain == 0
                || sourceChain == block.chainid || collateralVault == address(0) || collateralAsset == address(0)
                || collateralAmount == 0 || owner == address(0) || returnRecipient == address(0)
                || solanaMarkets[sourceChain].sourceGenesis != bytes32(0)
                || sourceCollateralVault[sourceChain][collateralAsset] != collateralVault
        ) revert InvalidCollateral();
        if (returnRecipient != c.returnRecipient && c.returnRecipient != address(0)) revert InvalidCollateral();
        if (c.collateralVault != address(0) && c.collateralVault != collateralVault) revert InvalidCollateral();
        if (c.collateralAsset != address(0) && c.collateralAsset != collateralAsset) revert InvalidCollateral();
        if (c.collateralAmount != 0 && c.collateralAmount != collateralAmount) revert InvalidCollateral();
        if (collateralSourceChainOf[creditId] != 0 && collateralSourceChainOf[creditId] != sourceChain) {
            revert InvalidCollateral();
        }
        collateralOwnerOf[creditId] = owner;
        collateralSourceChainOf[creditId] = sourceChain;
        c.collateralVault = collateralVault;
        c.collateralAsset = collateralAsset;
        c.collateralAmount = collateralAmount;
        c.returnRecipient = returnRecipient;
        c.lockId = lockId;
        c.collateralBound = true;
        remoteCollateral[creditId] = true;
        _pinVerifier(c, sourceChain);
        if (remoteRecoveryVaultOf[creditId] == address(0)) {
            _pinRemoteRecovery(creditId, sourceChain, collateralAsset);
        }
        lockBound[creditId][lockId] = true;
        c.facility = Types.Facility.Aborted;
        c.revision = RevisionLib.next(c.revision);
    }

    function bindCollateral(bytes32 creditId, bytes32 lockId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower) revert Unauthorized();
        if (
            c.facility != Types.Facility.CollateralLocking && c.facility != Types.Facility.CollateralProving
                && c.facility != Types.Facility.Aborted
        ) revert BadState();
        if (c.collateralVault == address(0) || lockBound[creditId][lockId]) revert InvalidCollateral();
        if (remoteCollateral[creditId]) revert InvalidCollateral();
        if (_requireLocalCollateralVault(c.collateralVault) != c.collateralAsset) revert InvalidCollateral();
        (
            bytes32 lockCredit,
            address owner,
            address lockAsset,
            uint256 sourceChain,
            uint256 amount,
            address recipient,
            uint256 deadline,,
            bool exists,
            bool released,
            bool seized
        ) = ICollateralVaultCore(c.collateralVault).lockInfo(lockId);
        address expectedOwner = collateralOwnerOf[creditId] == address(0) ? c.borrower : collateralOwnerOf[creditId];
        if (
            !exists || released || seized || lockCredit != creditId || owner != expectedOwner
                || recipient != c.returnRecipient || amount == 0 || sourceChain != collateralSourceChainOf[creditId]
                || (c.collateralAsset != address(0) && c.collateralAsset != lockAsset)
                || (c.collateralAmount != 0 && c.collateralAmount != amount)
        ) {
            revert InvalidCollateral();
        }
        if (block.timestamp > deadline && c.facility != Types.Facility.Aborted) revert Expired();
        if (c.facility != Types.Facility.Aborted && lockAsset != IHouseVaultCore(c.vault).asset()) {
            _requireLocalSalePolicy(lockAsset, IHouseVaultCore(c.vault).asset());
        }
        c.collateralAsset = lockAsset;
        c.collateralAmount = amount;
        collateralSourceChainOf[creditId] = sourceChain;
        c.lockId = lockId;
        c.collateralBound = true;
        collateralProven[creditId] = true;
        if (c.facility != Types.Facility.Aborted) c.facility = Types.Facility.CollateralProving;
        lockBound[creditId][lockId] = true;
        c.revision = RevisionLib.next(c.revision);
        if (c.facility != Types.Facility.Aborted) _maybeReady(c, creditId);
        emit Events.CollateralBound(creditId, lockId, amount);
    }

    function proveCollateral(bytes32 creditId, uint256 sourceChain, bytes calldata header, bytes calldata proof)
        external
        nonReentrant
    {
        Credit storage c = _credits[creditId];
        if (solanaCollateral[creditId]) revert InvalidCollateral();
        if (
            (c.facility != Types.Facility.CollateralProving && c.facility != Types.Facility.Aborted)
                || !c.collateralBound || verifierRegistry == address(0)
        ) revert InvalidCollateral();
        uint256 expectedSourceChain = collateralSourceChainOf[creditId];
        if (expectedSourceChain == 0 || sourceChain != expectedSourceChain) revert InvalidCollateral();
        (address impl,, bool active,, bytes32 codeHash) = IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (!active || impl.code.length == 0) revert InvalidCollateral();
        (, uint256 version,,,) = IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (
            c.verifierVersion == 0 || version != c.verifierVersion || codeHash != c.verifierCodeHash
                || impl.codehash != c.verifierCodeHash
        ) {
            revert InvalidCollateral();
        }
        address owner = collateralOwnerOf[creditId];
        address recoveryVault = remoteRecoveryVaultOf[creditId];
        if (recoveryVault == address(0)) revert InvalidCollateral();
        bytes32 expected = keccak256(
            abi.encode(
                creditId,
                c.lockId,
                c.borrower,
                owner,
                c.collateralVault,
                c.collateralAsset,
                c.collateralAmount,
                sourceChain,
                c.returnRecipient,
                recoveryVault,
                block.chainid,
                address(this)
            )
        );
        try IVerifierCore(impl).verifyLock(header, proof, c.collateralVault, expected) returns (bool verified) {
            if (!verified) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        collateralProven[creditId] = true;
        if (c.facility != Types.Facility.Aborted) _maybeReady(c, creditId);
    }

    function solanaLockDigest(bytes32 creditId) public view returns (bytes32) {
        Credit storage c = _credits[creditId];
        SolanaIdentity storage identity = solanaIdentityOf[creditId];
        if (!solanaCollateral[creditId] || c.lockId == bytes32(0) || solanaLockPdaOf[creditId] == bytes32(0)) {
            revert InvalidCollateral();
        }
        return keccak256(
            abi.encode(
                SOLANA_LOCK_DOMAIN,
                creditId,
                c.lockId,
                identity.sourceGenesis,
                identity.programId,
                solanaLockPdaOf[creditId],
                identity.sourceAsset,
                identity.sourceOwner,
                c.borrower,
                identity.returnRecipient,
                identity.recoveryVault,
                block.chainid,
                address(this),
                c.collateralAmount,
                c.setupDeadline,
                c.termsHash,
                identity.verifierVersion
            )
        );
    }

    function _pinnedSolanaVerifier(Credit storage c, bytes32 creditId) internal view returns (address impl) {
        if (!solanaCollateral[creditId] || verifierRegistry == address(0)) revert InvalidCollateral();
        uint256 version;
        bool active;
        bytes32 codeHash;
        (impl, version, active,, codeHash) =
            IVerifierRegistryCore(verifierRegistry).verifiers(collateralSourceChainOf[creditId]);
        if (
            !active || impl.code.length == 0 || c.verifierVersion == 0
                || version != c.verifierVersion || codeHash != c.verifierCodeHash
                || impl.codehash != c.verifierCodeHash
        ) revert InvalidCollateral();
    }

    function proveSolanaCollateral(bytes32 creditId, bytes calldata header, bytes calldata proof)
        external
        nonReentrant
    {
        Credit storage c = _credits[creditId];
        if (
            (c.facility != Types.Facility.CollateralProving && c.facility != Types.Facility.Aborted)
                || !c.collateralBound
        ) revert InvalidCollateral();
        address impl = _pinnedSolanaVerifier(c, creditId);
        SolanaIdentity storage identity = solanaIdentityOf[creditId];
        try ISolanaVerifierCore(impl).verifySolanaLock(
            header, proof, identity.sourceGenesis, identity.programId, solanaLockDigest(creditId)
        ) returns (bool verified) {
            if (!verified) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        collateralProven[creditId] = true;
        if (c.facility != Types.Facility.Aborted) _maybeReady(c, creditId);
    }

    function bindAccount(bytes32 creditId, address account) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower) revert Unauthorized();
        if (
            account.code.length == 0 || c.account != address(0)
                || (c.facility != Types.Facility.Reserved
                    && c.facility != Types.Facility.CollateralLocking
                    && c.facility != Types.Facility.CollateralProving
                    && c.facility != Types.Facility.AccountCreating) || block.timestamp > c.setupDeadline
        ) revert InvalidAccount();
        if (
            ICreditAccountCore(account).creditId() != creditId || ICreditAccountCore(account).borrower() != c.borrower
                || ICreditAccountCore(account).core() != address(this)
        ) {
            revert InvalidAccount();
        }
        c.account = account;
        if (c.facility == Types.Facility.Reserved) c.facility = Types.Facility.AccountCreating;
        c.revision = RevisionLib.next(c.revision);
        _maybeReady(c, creditId);
    }

    function _maybeReady(Credit storage c, bytes32 creditId) internal {
        if (
            block.timestamp <= c.setupDeadline && c.account != address(0) && c.collateralBound
                && collateralProven[creditId]
        ) {
            if (remoteCollateral[creditId]) {
                _requireRemoteSalePolicy(
                    collateralSourceChainOf[creditId], c.collateralAsset, IHouseVaultCore(c.vault).asset()
                );
            }
            _settleBond(c, creditId);
            c.facility = Types.Facility.Ready;
            c.payment = Types.Payment.Current;
            c.accruedAt = block.timestamp;
            emit Events.CreditReady(creditId);
        }
    }

    function accrue(bytes32 creditId) external nonReentrant {
        _accrue(_credits[creditId], creditId);
    }

    function _accrue(Credit storage c, bytes32 creditId) internal {
        if (c.revision == 0) revert BadState();
        if (c.accruedAt == 0) {
            c.accruedAt = block.timestamp;
            return;
        }
        if (block.timestamp <= c.accruedAt) return;
        uint256 elapsed = block.timestamp - c.accruedAt;
        uint256 interest;
        uint256 commitmentFee;
        if (c.principal > 0 && c.aprBps > 0) {
            interest = c.principal * c.aprBps * elapsed / BPS / YEAR;
        }
        uint256 commitmentElapsed = elapsed;
        if (c.maturity > 0 && c.accruedAt >= c.maturity) commitmentElapsed = 0;
        else if (c.maturity > 0 && block.timestamp > c.maturity) commitmentElapsed = c.maturity - c.accruedAt;
        if (
            c.facility == Types.Facility.Ready && c.commitmentFeeBps > 0 && c.vault != address(0)
                && commitmentElapsed > 0
        ) {
            uint256 committed = IHouseVaultCore(c.vault).creditCommitted(creditId);
            if (committed > 0) commitmentFee = committed * c.commitmentFeeBps * commitmentElapsed / BPS / YEAR;
        }
        uint256 total = interest + commitmentFee;
        if (total > 0) {
            c.accruedInterest += interest;
            c.accruedFees += commitmentFee;
            c.debt += total;
            IHouseVaultCore(c.vault).recordAccruedReceivable(creditId, total);
        }
        c.accruedAt = block.timestamp;
    }

    function _previewDebt(Credit memory c, bytes32 creditId) internal view returns (uint256) {
        (uint256 interest, uint256 commitmentFee) = _previewAccrual(c, creditId);
        return c.debt + interest + commitmentFee;
    }

    function _previewAccrual(Credit memory c, bytes32 creditId)
        internal
        view
        returns (uint256 interest, uint256 commitmentFee)
    {
        if (c.accruedAt == 0 || block.timestamp <= c.accruedAt) return (0, 0);
        uint256 elapsed = block.timestamp - c.accruedAt;
        if (c.principal > 0 && c.aprBps > 0) interest = c.principal * c.aprBps * elapsed / BPS / YEAR;
        uint256 commitmentElapsed = elapsed;
        if (c.maturity > 0 && c.accruedAt >= c.maturity) commitmentElapsed = 0;
        else if (c.maturity > 0 && block.timestamp > c.maturity) commitmentElapsed = c.maturity - c.accruedAt;
        if (
            c.facility == Types.Facility.Ready && c.commitmentFeeBps > 0 && c.vault != address(0)
                && commitmentElapsed > 0
        ) {
            uint256 committed = IHouseVaultCore(c.vault).creditCommitted(creditId);
            if (committed > 0) commitmentFee = committed * c.commitmentFeeBps * commitmentElapsed / BPS / YEAR;
        }
    }

    function abort(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower) revert Unauthorized();
        _abortSetup(c, creditId);
    }

    function expireSetup(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (c.setupDeadline == 0 || block.timestamp <= c.setupDeadline) revert Expired();
        _abortSetup(c, creditId);
    }

    function _abortSetup(Credit storage c, bytes32 creditId) internal {
        if (
            c.debt != 0
                || (c.facility != Types.Facility.Reserved
                    && c.facility != Types.Facility.CollateralLocking
                    && c.facility != Types.Facility.CollateralProving
                    && c.facility != Types.Facility.AccountCreating)
        ) revert BadState();
        if (c.vault != address(0)) {
            uint256 committed = IHouseVaultCore(c.vault).creditCommitted(creditId);
            if (committed > 0) IHouseVaultCore(c.vault).release(creditId, committed);
        }
        if (c.vault != address(0) && c.reservationBond > 0 && !bondSettled[creditId]) {
            IHouseVaultCore(c.vault).refundBond(creditId, c.borrower, c.reservationBond);
        }
        c.revision = RevisionLib.next(c.revision);
        sessionGeneration[creditId] += 1;
        c.facility = Types.Facility.Aborted;
        emit Events.CreditAborted(creditId);
    }

    function authorizeReturn(bytes32 creditId, bytes32 lockId, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        bool repaidRecovery = _repaidRecoveryCanReturn(c, creditId);
        if (
            msg.sender != c.borrower
                || (c.facility != Types.Facility.Closing && c.facility != Types.Facility.Aborted && !repaidRecovery)
                || lockId != c.lockId || c.collateralReturned
        ) revert Unauthorized();
        if (c.facility == Types.Facility.Closing || repaidRecovery) _requireExitReady(c, creditId);
        if (amount == 0 || amount > c.collateralAmount) revert InvalidCollateral();
        if (remoteCollateral[creditId]) {
            if (pendingRemoteReturn[creditId] != 0 || pendingRemoteSeizure[creditId] != 0) revert Pending();
            uint256 available = c.collateralAmount - pendingRemoteReturn[creditId];
            if (amount > available) revert InvalidCollateral();
            pendingRemoteReturn[creditId] += amount;
            uint256 nonce = ++remoteActionNonce[creditId];
            uint256 deadline = solanaCollateral[creditId]
                ? uint256(uint64(type(int64).max)) : block.timestamp + 7 days;
            bytes32 actionHash = solanaCollateral[creditId]
                ? solanaActionHash(creditId, RemoteAction.RELEASE, amount, nonce, deadline)
                : RemoteAction.hash(_remoteAction(
                    c, creditId, RemoteAction.RELEASE, c.returnRecipient, amount, nonce, deadline
                ));
            remoteReturnActionHash[creditId] = actionHash;
            remoteReturnDeadline[creditId] = deadline;
            c.revision = RevisionLib.next(c.revision);
            emit Events.RemoteReturnRequested(creditId, lockId, amount, c.returnRecipient);
            emit RemoteActionAuthorized(creditId, actionHash, RemoteAction.RELEASE);
            return;
        }
        ICollateralVaultCore(c.collateralVault).release(lockId, c.returnRecipient, amount, c.revision);
        c.collateralAmount -= amount;
        if (c.collateralAmount == 0) {
            c.collateralReturned = true;
            lockReturned[creditId][lockId] = true;
        }
        c.revision = RevisionLib.next(c.revision);
        emit Events.CollateralReturned(creditId, lockId, amount);
    }

    function _remoteAction(
        Credit storage c,
        bytes32 creditId,
        uint8 kind,
        address recipient,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (RemoteAction.Authorization memory action) {
        action = RemoteAction.Authorization({
            monadChain: block.chainid,
            monadCore: address(this),
            sourceChain: collateralSourceChainOf[creditId],
            sourceVault: c.collateralVault,
            creditId: creditId,
            lockId: c.lockId,
            asset: c.collateralAsset,
            kind: kind,
            recipient: recipient,
            amount: amount,
            nonce: nonce,
            deadline: deadline
        });
    }

    function solanaActionHash(bytes32 creditId, uint8 kind, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        Credit storage c = _credits[creditId];
        SolanaIdentity storage identity = solanaIdentityOf[creditId];
        if (
            !solanaCollateral[creditId] || c.lockId == bytes32(0) || solanaLockPdaOf[creditId] == bytes32(0)
                || kind > RemoteAction.SEIZE || amount == 0 || amount > type(uint64).max
                || nonce == 0 || nonce > type(uint64).max || deadline > uint256(uint64(type(int64).max))
        ) revert InvalidCollateral();
        bytes32 recipient = kind == RemoteAction.RELEASE ? identity.returnRecipient : identity.recoveryVault;
        return keccak256(
            abi.encode(
                SOLANA_ACTION_DOMAIN,
                block.chainid,
                address(this),
                identity.sourceGenesis,
                identity.programId,
                solanaLockPdaOf[creditId],
                creditId,
                c.lockId,
                identity.sourceAsset,
                kind,
                recipient,
                amount,
                nonce,
                deadline,
                identity.verifierVersion
            )
        );
    }

    function authorizeRemoteSeizure(bytes32 creditId, uint256 amount, uint256 deadline) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (!recoveryKeepers[msg.sender]) revert Unauthorized();
        if (
            !remoteCollateral[creditId]
                || (c.facility != Types.Facility.Liquidating && c.facility != Types.Facility.RecoveryPending)
                || c.recoveryFinalized || pendingRemoteSeizure[creditId] != 0
                || pendingRemoteReturn[creditId] != 0 || amount == 0 || amount > c.collateralAmount
                || c.debt == 0 || deadline <= block.timestamp || deadline > block.timestamp + 7 days
        ) revert BadState();
        address destination = remoteRecoveryVaultOf[creditId];
        if (destination == address(0)) revert InvalidCollateral();
        uint256 nonce = ++remoteActionNonce[creditId];
        bytes32 actionHash = solanaCollateral[creditId]
            ? solanaActionHash(creditId, RemoteAction.SEIZE, amount, nonce, deadline)
            : RemoteAction.hash(_remoteAction(
                c, creditId, RemoteAction.SEIZE, destination, amount, nonce, deadline
            ));
        pendingRemoteSeizure[creditId] = amount;
        remoteSeizureActionHash[creditId] = actionHash;
        remoteSeizureRecipient[creditId] = destination;
        remoteSeizureDeadline[creditId] = deadline;
        c.revision = RevisionLib.next(c.revision);
        emit RemoteActionAuthorized(creditId, actionHash, RemoteAction.SEIZE);
    }

    function confirmRemoteReturn(bytes32 creditId, bytes calldata header, bytes calldata proof) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (
            (c.facility != Types.Facility.Closing && c.facility != Types.Facility.Aborted
                && !_repaidRecoveryCanReturn(c, creditId))
                || !remoteCollateral[creditId] || pendingRemoteReturn[creditId] == 0 || verifierRegistry == address(0)
        ) revert Pending();
        uint256 amount = pendingRemoteReturn[creditId];
        bytes32 eventDigest = solanaCollateral[creditId]
            ? remoteReturnActionHash[creditId]
            : keccak256(abi.encode(
                remoteReturnActionHash[creditId], c.lockId, c.returnRecipient, amount, RemoteAction.RELEASE
            ));
        _verifyRemoteEvent(c, creditId, header, proof, eventDigest);
        pendingRemoteReturn[creditId] = 0;
        remoteReturnActionHash[creditId] = bytes32(0);
        remoteReturnDeadline[creditId] = 0;
        c.collateralAmount -= amount;
        if (c.collateralAmount == 0) {
            c.collateralReturned = true;
            lockReturned[creditId][c.lockId] = true;
        }
        c.revision = RevisionLib.next(c.revision);
        emit Events.CollateralReturned(creditId, c.lockId, amount);
    }

    function _repaidRecoveryCanReturn(Credit storage c, bytes32 creditId) internal view returns (bool) {
        return (c.facility == Types.Facility.RecoveryPending || c.facility == Types.Facility.Liquidated)
            && c.debt == 0 && pendingRemoteSeizure[creditId] == 0;
    }

    function confirmRemoteSeizure(bytes32 creditId, bytes calldata header, bytes calldata proof)
        external nonReentrant
    {
        Credit storage c = _credits[creditId];
        if (
            !remoteCollateral[creditId] || pendingRemoteSeizure[creditId] == 0
                || (c.facility != Types.Facility.Liquidating && c.facility != Types.Facility.RecoveryPending)
        ) revert Pending();
        uint256 amount = pendingRemoteSeizure[creditId];
        address recipient = remoteSeizureRecipient[creditId];
        bytes32 eventDigest = solanaCollateral[creditId]
            ? remoteSeizureActionHash[creditId]
            : keccak256(abi.encode(
                remoteSeizureActionHash[creditId], c.lockId, recipient, amount, RemoteAction.SEIZE
            ));
        _verifyRemoteEvent(c, creditId, header, proof, eventDigest);
        bytes32 actionHash = remoteSeizureActionHash[creditId];
        pendingRemoteSeizure[creditId] = 0;
        remoteSeizureActionHash[creditId] = bytes32(0);
        remoteSeizureRecipient[creditId] = address(0);
        remoteSeizureDeadline[creditId] = 0;
        remoteSeizureConfirmed[creditId] = true;
        c.collateralAmount -= amount;
        c.facility = Types.Facility.RecoveryPending;
        c.revision = RevisionLib.next(c.revision);
        emit RemoteSeizureConfirmed(creditId, actionHash, amount);
    }

    function cancelExpiredRemoteSeizure(bytes32 creditId, bytes calldata header, bytes calldata proof)
        external nonReentrant
    {
        Credit storage c = _credits[creditId];
        bytes32 actionHash = remoteSeizureActionHash[creditId];
        uint256 deadline = remoteSeizureDeadline[creditId];
        if (
            !remoteCollateral[creditId] || solanaCollateral[creditId]
                || collateralSourceChainOf[creditId] != 1 || pendingRemoteSeizure[creditId] == 0
                || actionHash == bytes32(0) || deadline == 0 || block.timestamp <= deadline
                || verifierRegistry == address(0)
        ) revert Pending();
        (address impl, uint256 version, bool active,, bytes32 codeHash) =
            IVerifierRegistryCore(verifierRegistry).verifiers(1);
        if (
            !active || impl.code.length == 0 || c.verifierVersion == 0
                || version != c.verifierVersion || codeHash != c.verifierCodeHash
                || impl.codehash != c.verifierCodeHash
        ) revert InvalidCollateral();
        address controller;
        try IUnconsumedRemoteActionVerifier(impl).sourceController() returns (address configured) {
            controller = configured;
        } catch {
            revert InvalidCollateral();
        }
        if (controller == address(0)) revert InvalidCollateral();
        try IUnconsumedRemoteActionVerifier(impl).sourceVault() returns (address configured) {
            if (configured != c.collateralVault) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        try IUnconsumedRemoteActionVerifier(impl).verifyUnconsumedAction(
            header, proof, controller, actionHash, deadline
        ) returns (bool verified) {
            if (!verified) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        pendingRemoteSeizure[creditId] = 0;
        remoteSeizureActionHash[creditId] = bytes32(0);
        remoteSeizureRecipient[creditId] = address(0);
        remoteSeizureDeadline[creditId] = 0;
        c.revision = RevisionLib.next(c.revision);
        emit RemoteSeizureCancelled(creditId, actionHash);
    }

    function cancelExpiredRemoteReturn(bytes32 creditId, bytes calldata header, bytes calldata proof)
        external nonReentrant
    {
        Credit storage c = _credits[creditId];
        bytes32 actionHash = remoteReturnActionHash[creditId];
        uint256 deadline = remoteReturnDeadline[creditId];
        if (
            !remoteCollateral[creditId] || solanaCollateral[creditId]
                || collateralSourceChainOf[creditId] != 1 || pendingRemoteReturn[creditId] == 0
                || actionHash == bytes32(0) || deadline == 0 || block.timestamp <= deadline
                || verifierRegistry == address(0)
        ) revert Pending();
        (address impl, uint256 version, bool active,, bytes32 codeHash) =
            IVerifierRegistryCore(verifierRegistry).verifiers(1);
        if (
            !active || impl.code.length == 0 || c.verifierVersion == 0
                || version != c.verifierVersion || codeHash != c.verifierCodeHash
                || impl.codehash != c.verifierCodeHash
        ) revert InvalidCollateral();
        address controller;
        try IUnconsumedRemoteActionVerifier(impl).sourceController() returns (address configured) {
            controller = configured;
        } catch {
            revert InvalidCollateral();
        }
        if (controller == address(0)) revert InvalidCollateral();
        try IUnconsumedRemoteActionVerifier(impl).sourceVault() returns (address configured) {
            if (configured != c.collateralVault) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        try IUnconsumedRemoteActionVerifier(impl).verifyUnconsumedAction(
            header, proof, controller, actionHash, deadline
        ) returns (bool verified) {
            if (!verified) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        pendingRemoteReturn[creditId] = 0;
        remoteReturnActionHash[creditId] = bytes32(0);
        remoteReturnDeadline[creditId] = 0;
        c.revision = RevisionLib.next(c.revision);
        emit RemoteReturnCancelled(creditId, actionHash);
    }

    function sourceRecoveryReturnHash(bytes32 creditId, uint256 amount, uint256 nonce, uint256 deadline)
        public view returns (bytes32)
    {
        Credit storage c = _credits[creditId];
        return keccak256(abi.encode(
            SOURCE_RECOVERY_RETURN_DOMAIN, block.chainid, address(this), collateralSourceChainOf[creditId],
            remoteRecoveryVaultOf[creditId], creditId, c.collateralAsset, collateralOwnerOf[creditId],
            amount, nonce, deadline
        ));
    }

    function authorizeSourceRecoveryReturn(bytes32 creditId, uint256 amount, uint256 deadline)
        external nonReentrant returns (bytes32 actionHash)
    {
        Credit storage c = _credits[creditId];
        address owner = collateralOwnerOf[creditId];
        if (msg.sender != c.borrower && msg.sender != owner) revert Unauthorized();
        if (
            !remoteCollateral[creditId] || solanaCollateral[creditId] || !remoteSeizureConfirmed[creditId]
                || c.debt != 0
                || pendingRemoteSeizure[creditId] != 0
                || (c.facility != Types.Facility.RecoveryPending && c.facility != Types.Facility.Liquidated)
                || remoteRecoveryVaultOf[creditId] == address(0) || owner == address(0)
                || amount == 0 || deadline <= block.timestamp || deadline > block.timestamp + 7 days
        ) revert BadState();
        uint256 nonce = ++remoteActionNonce[creditId];
        actionHash = sourceRecoveryReturnHash(creditId, amount, nonce, deadline);
        c.revision = RevisionLib.next(c.revision);
        emit SourceRecoveryReturnAuthorized(creditId, actionHash, owner, amount, nonce, deadline);
        emit RemoteActionAuthorized(creditId, actionHash, RemoteAction.RELEASE);
    }

    function _verifyRemoteEvent(
        Credit storage c,
        bytes32 creditId,
        bytes calldata header,
        bytes calldata proof,
        bytes32 eventDigest
    ) internal view {
        if (solanaCollateral[creditId]) {
            address solanaVerifier = _pinnedSolanaVerifier(c, creditId);
            SolanaIdentity storage identity = solanaIdentityOf[creditId];
            try ISolanaVerifierCore(solanaVerifier).verifySolanaAction(
                header,
                proof,
                identity.sourceGenesis,
                identity.programId,
                solanaLockPdaOf[creditId],
                eventDigest
            ) returns (bool verified) {
                if (!verified) revert InvalidCollateral();
            } catch {
                revert InvalidCollateral();
            }
            return;
        }
        if (verifierRegistry == address(0)) revert InvalidCollateral();
        (address impl, uint256 version, bool active,, bytes32 codeHash) =
            IVerifierRegistryCore(verifierRegistry).verifiers(collateralSourceChainOf[creditId]);
        if (
            !active || impl.code.length == 0 || c.verifierVersion == 0
                || version != c.verifierVersion || codeHash != c.verifierCodeHash
                || impl.codehash != c.verifierCodeHash
        ) revert InvalidCollateral();
        try IVerifierCore(impl).verifyEvent(header, proof, c.collateralVault, eventDigest) returns (bool verified) {
            if (!verified) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
    }

    function withdrawCollateral(bytes32 creditId, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (
            msg.sender != c.borrower || c.facility != Types.Facility.Ready || c.lockId == bytes32(0)
                || remoteCollateral[creditId]
        ) revert Unauthorized();
        if (amount == 0 || amount >= c.collateralAmount) revert InvalidCollateral();
        _accrue(c, creditId);
        if (riskEngine != address(0)) {
            Types.HealthSnapshot memory snapshot =
                c.debt > 0 ? _requireFreshHealth(c, creditId) : IRiskCore(riskEngine).snapshot(creditId);
            uint256 sourceValueAfter =
                c.collateralAmount == 0 ? 0 : snapshot.sourceValue * (c.collateralAmount - amount) / c.collateralAmount;
            IRiskCore(riskEngine).checkCollateralWithdraw(creditId, sourceValueAfter);
            IRiskCore(riskEngine).applyCollateralWithdraw(creditId, sourceValueAfter);
        }
        ICollateralVaultCore(c.collateralVault).release(c.lockId, c.returnRecipient, amount, c.revision);
        c.collateralAmount -= amount;
        c.revision = RevisionLib.next(c.revision);
    }

    function draw(
        bytes32 creditId,
        uint256 amount,
        uint256 maxBound,
        uint256 borrowerNonce,
        uint256 deadline,
        bytes calldata borrowerSig
    ) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (c.facility != Types.Facility.Ready || paused) revert BadState();
        bytes32 digest = keccak256(abi.encode(domain, creditId, amount, maxBound, borrowerNonce, deadline, c.revision));
        if (block.timestamp > deadline || block.timestamp >= c.maturity) revert Expired();
        if (nonceUsed[creditId][borrowerNonce] || !AuthLib.verify(digest, borrowerSig, c.borrower)) revert BadSig();
        _draw(c, creditId, amount, maxBound, borrowerNonce, borrowerNonce, true);
    }

    function setSession(bytes32 creditId, address sessionKey, bytes32 capability, uint256 perAction, uint256 expiry)
        external
    {
        _setSession(creditId, sessionKey, capability, perAction, perAction, expiry);
    }

    function setSessionWithTotal(
        bytes32 creditId,
        address sessionKey,
        bytes32 capability,
        uint256 perAction,
        uint256 total,
        uint256 expiry
    ) external {
        _setSession(creditId, sessionKey, capability, perAction, total, expiry);
    }

    function _setSession(
        bytes32 creditId,
        address sessionKey,
        bytes32 capability,
        uint256 perAction,
        uint256 total,
        uint256 expiry
    ) internal {
        Credit storage c = _credits[creditId];
        if (
            msg.sender != c.borrower || c.facility != Types.Facility.Ready || sessionKey == address(0) || perAction == 0
                || total < perAction || expiry <= block.timestamp
        ) revert Unauthorized();
        bytes32 previous = sessionCapabilityOf[creditId][sessionKey];
        if (previous != bytes32(0) && previous != capability) {
            sessionCapabilityLimit[creditId][sessionKey][previous] = 0;
        }
        sessionCapabilityOf[creditId][sessionKey] = capability;
        sessionCapabilityLimit[creditId][sessionKey][capability] = perAction;
        sessionLimits[creditId][sessionKey] = perAction;
        sessionTotalLimit[creditId][sessionKey] = total;
        sessionSpent[creditId][sessionKey] = 0;
        sessionExpiry[creditId][sessionKey] = expiry;
        sessionNonces[creditId][sessionKey] += 1;
        sessionGenerationAt[creditId][sessionKey] = sessionGeneration[creditId];
    }

    function revokeSession(bytes32 creditId, address sessionKey) external {
        if (msg.sender != _credits[creditId].borrower) revert Unauthorized();
        bytes32 capability = sessionCapabilityOf[creditId][sessionKey];
        if (capability != bytes32(0)) sessionCapabilityLimit[creditId][sessionKey][capability] = 0;
        sessionCapabilityOf[creditId][sessionKey] = bytes32(0);
        sessionLimits[creditId][sessionKey] = 0;
        sessionTotalLimit[creditId][sessionKey] = 0;
        sessionSpent[creditId][sessionKey] = 0;
        sessionExpiry[creditId][sessionKey] = 0;
        sessionNonces[creditId][sessionKey] += 1;
    }

    function drawWithSession(
        bytes32 creditId,
        bytes32 capability,
        uint256 amount,
        uint256 maxBound,
        address sessionKey,
        uint256 sessionNonce,
        uint256 deadline,
        bytes calldata sessionSig
    ) external nonReentrant {
        Credit storage c = _credits[creditId];
        uint256 cap = sessionCapabilityLimit[creditId][sessionKey][capability];
        uint256 total = sessionTotalLimit[creditId][sessionKey];
        uint256 spent = sessionSpent[creditId][sessionKey];
        uint256 remaining = total > spent ? total - spent : 0;
        if (
            c.facility != Types.Facility.Ready || paused || cap == 0 || amount > cap || amount > remaining
                || block.timestamp > deadline || block.timestamp >= c.maturity
                || block.timestamp > sessionExpiry[creditId][sessionKey]
                || sessionGenerationAt[creditId][sessionKey] != sessionGeneration[creditId]
        ) revert Unauthorized();
        if (sessionNonce != sessionNonces[creditId][sessionKey]) revert Used();
        bytes32 digest = keccak256(
            abi.encode(domain, creditId, capability, amount, maxBound, sessionKey, sessionNonce, deadline, c.revision)
        );
        if (!AuthLib.verify(digest, sessionSig, sessionKey)) revert BadSig();
        sessionNonces[creditId][sessionKey] = sessionNonce + 1;
        sessionSpent[creditId][sessionKey] += amount;
        uint256 nonceKey = uint256(keccak256(abi.encode("termbook-session", creditId, sessionKey, sessionNonce)));
        _draw(c, creditId, amount, maxBound, nonceKey, sessionNonce, true);
    }

    function executeAction(
        bytes32 creditId,
        address target,
        bytes calldata data,
        uint256 amount,
        uint256 maxBound,
        uint256 borrowerNonce,
        uint256 deadline,
        bytes calldata borrowerSig
    ) external nonReentrant returns (bytes memory result) {
        Credit storage c = _credits[creditId];
        if (c.facility != Types.Facility.Ready || paused) revert BadState();
        if (data.length < 4) revert Unauthorized();
        bytes4 selector = bytes4(data[:4]);
        bool allowed = integrationRegistry != address(0)
            ? IIntegrationRegistryCore(integrationRegistry).validateCall(c.bundleId, target, data, c.account, amount)
            : approvedCalls[target][selector];
        if (!allowed) revert Unauthorized();
        bytes32 actionHash = keccak256(abi.encode(target, data));
        bytes32 digest =
            keccak256(abi.encode(domain, creditId, actionHash, amount, maxBound, borrowerNonce, deadline, c.revision));
        if (
            block.timestamp > deadline || nonceUsed[creditId][borrowerNonce]
                || !AuthLib.verify(digest, borrowerSig, c.borrower)
        ) revert BadSig();
        if (amount > 0) {
            _draw(c, creditId, amount, maxBound, borrowerNonce, borrowerNonce, false);
        } else {
            nonceUsed[creditId][borrowerNonce] = true;
            c.nonce = borrowerNonce;
            c.revision = RevisionLib.next(c.revision);
        }
        if (amount > 0) {
            address token = IHouseVaultCore(c.vault).asset();
            ICreditAccountCore(c.account).approveSpend(token, target, 0);
            ICreditAccountCore(c.account).approveSpend(token, target, amount);
            result = ICreditAccountCore(c.account).execute(target, data);
            ICreditAccountCore(c.account).approveSpend(token, target, 0);
        } else {
            result = ICreditAccountCore(c.account).execute(target, data);
        }
        _recordPostActionHealth(c, creditId);
    }

    function _recordPostActionHealth(Credit storage c, bytes32 creditId) internal {
        if (healthSource == address(0) || riskEngine == address(0)) revert BadHealth();
        Types.HealthSnapshot memory snapshot_ =
            IHealthSourceCore(healthSource).snapshot(creditId, c.bundleId, c.revision, c.debt);
        if (snapshot_.debt != c.debt) revert BadHealth();
        IRiskCore(riskEngine).record(creditId, snapshot_);
        IRiskCore(riskEngine).checkDraw(creditId, c.debt);
        healthSnapshotAt[creditId] = block.timestamp;
        healthSnapshotRevision[creditId] = c.revision;
    }

    function _draw(
        Credit storage c,
        bytes32 creditId,
        uint256 amount,
        uint256 maxBound,
        uint256 nonceKey,
        uint256 recordedNonce,
        bool checkBeforeDraw
    ) internal {
        if (amount == 0 || amount > maxBound) revert OverLimit();
        if (remoteCollateral[creditId]) {
            _requireRemoteSalePolicy(collateralSourceChainOf[creditId], c.collateralAsset, IHouseVaultCore(c.vault).asset());
        } else if (_requireLocalCollateralVault(c.collateralVault) != c.collateralAsset) {
            revert InvalidCollateral();
        }
        _accrue(c, creditId);
        uint256 capacity =
            c.revolving ? (c.limit > c.debt ? c.limit - c.debt : 0) : (c.limit > c.drawn ? c.limit - c.drawn : 0);
        if (amount > capacity) revert OverLimit();
        if (riskEngine == address(0)) revert BadHealth();
        _requireFreshHealth(c, creditId);
        uint256 originationFee;
        if (!c.originationCharged && c.originationFee > 0) {
            originationFee = c.originationFee;
            c.originationCharged = true;
        }
        if (checkBeforeDraw) IRiskCore(riskEngine).checkDraw(creditId, c.debt + amount + originationFee);
        nonceUsed[creditId][nonceKey] = true;
        IHouseVaultCore(c.vault).fundDraw(creditId, c.account, amount);
        if (originationFee > 0) {
            c.accruedFees += originationFee;
            IHouseVaultCore(c.vault).recordAccruedReceivable(creditId, originationFee);
        }
        c.principal += amount;
        c.debt += amount;
        c.debt += originationFee;
        c.drawn += amount;
        c.nonce = recordedNonce;
        c.revision = RevisionLib.next(c.revision);
        emit Events.Drawn(creditId, amount, c.debt);
    }

    function repay(bytes32 creditId, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower && msg.sender != c.account) revert Unauthorized();
        _repay(c, creditId, amount, msg.sender == c.account);
    }

    function repayFromAccount(bytes32 creditId, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower) revert Unauthorized();
        _repay(c, creditId, amount, true);
    }

    function _repay(Credit storage c, bytes32 creditId, uint256 amount, bool fromAccount) internal {
        _accrue(c, creditId);
        if (amount == 0 || amount > c.debt) revert BadState();
        address token = IHouseVaultCore(c.vault).asset();
        uint256 vaultBalance = token.balanceOf(c.vault);
        if (fromAccount) {
            if (healthSource == address(0)) revert BadHealth();
            Types.HealthSnapshot memory accountHealth =
                IHealthSourceCore(healthSource).snapshot(creditId, c.bundleId, c.revision, c.debt);
            if (accountHealth.debt != c.debt) revert BadHealth();
            if (amount > accountHealth.cash) revert OverLimit();
            ICreditAccountCore(c.account).transferToken(token, c.vault, amount);
        } else {
            token.safeTransferFrom(msg.sender, c.vault, amount);
        }
        if (token.balanceOf(c.vault) - vaultBalance != amount) revert BadHealth();
        uint256 remaining = amount;
        uint256 feePaid = remaining > c.accruedFees ? c.accruedFees : remaining;
        remaining -= feePaid;
        uint256 interestPaid = remaining > c.accruedInterest ? c.accruedInterest : remaining;
        remaining -= interestPaid;
        uint256 principalPaid = remaining;
        if (principalPaid > c.principal) revert BadState();
        c.accruedFees -= feePaid;
        c.accruedInterest -= interestPaid;
        c.principal -= principalPaid;
        IHouseVaultCore(c.vault).receiveRepay(creditId, amount, principalPaid, interestPaid, feePaid);
        if (c.revolving && principalPaid > 0) IHouseVaultCore(c.vault).restoreCommitment(creditId, principalPaid);
        if (
            c.facility == Types.Facility.Liquidating || c.facility == Types.Facility.RecoveryPending
                || c.facility == Types.Facility.Liquidated
        ) {
            c.recovery += amount;
            if (c.facility != Types.Facility.Liquidated) c.facility = Types.Facility.RecoveryPending;
        }
        c.debt -= amount;
        c.revision = RevisionLib.next(c.revision);
        if (c.debt == 0 && c.payment == Types.Payment.Current) c.payment = Types.Payment.Repaid;
        emit Events.Repaid(creditId, amount, c.debt);
    }

    function applySettlement(bytes32 creditId, address inbox, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.vault || amount == 0) revert Unauthorized();
        _accrue(c, creditId);
        if (amount > c.debt) revert BadState();
        uint256 remaining = amount;
        uint256 feePaid = remaining > c.accruedFees ? c.accruedFees : remaining;
        remaining -= feePaid;
        uint256 interestPaid = remaining > c.accruedInterest ? c.accruedInterest : remaining;
        remaining -= interestPaid;
        uint256 principalPaid = remaining;
        if (principalPaid > c.principal) revert BadState();
        c.accruedFees -= feePaid;
        c.accruedInterest -= interestPaid;
        c.principal -= principalPaid;
        IHouseVaultCore(c.vault).applyRepaymentSettlement(creditId, inbox, amount, principalPaid, interestPaid, feePaid);
        if (c.revolving && principalPaid > 0) IHouseVaultCore(c.vault).restoreCommitment(creditId, principalPaid);
        c.debt -= amount;
        if (
            c.facility == Types.Facility.Liquidating || c.facility == Types.Facility.RecoveryPending
                || c.facility == Types.Facility.Liquidated
        ) {
            c.recovery += amount;
            if (c.facility != Types.Facility.Liquidated) c.facility = Types.Facility.RecoveryPending;
        }
        c.revision = RevisionLib.next(c.revision);
        if (c.debt == 0 && c.payment == Types.Payment.Current) c.payment = Types.Payment.Repaid;
        emit Events.Repaid(creditId, amount, c.debt);
    }

    function withdraw(bytes32 creditId, address token, address recipient, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (
            msg.sender != c.borrower || (c.facility != Types.Facility.Ready && c.facility != Types.Facility.Closing)
                || recipient != c.borrower
        ) revert Unauthorized();
        if (c.facility == Types.Facility.Closing) _requireExitReady(c, creditId);
        _accrue(c, creditId);
        if (token != IHouseVaultCore(c.vault).asset()) revert InvalidTerms();
        uint256 balance = ICreditAccountCore(c.account).tokenBalance(token);
        if (amount == 0 || amount > balance) revert OverLimit();
        uint256 cashAfter;
        if (riskEngine != address(0)) {
            Types.HealthSnapshot memory snapshot =
                c.debt > 0 ? _requireFreshHealth(c, creditId) : IRiskCore(riskEngine).snapshot(creditId);
            if (amount > snapshot.cash) revert OverLimit();
            cashAfter = snapshot.cash - amount;
            if (c.debt > 0) IRiskCore(riskEngine).checkWithdraw(creditId, cashAfter);
            IRiskCore(riskEngine).applyCashWithdraw(creditId, cashAfter);
        }
        ICreditAccountCore(c.account).transferToken(token, recipient, amount);
        c.revision = RevisionLib.next(c.revision);
    }

    function markMatured(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (block.timestamp < c.maturity || c.facility == Types.Facility.Closed || c.facility == Types.Facility.Aborted)
        {
            revert BadState();
        }
        _accrue(c, creditId);
        if (c.facility == Types.Facility.Ready && c.vault != address(0)) {
            uint256 committed = IHouseVaultCore(c.vault).creditCommitted(creditId);
            if (committed > 0) IHouseVaultCore(c.vault).release(creditId, committed);
        }
        if (c.payment == Types.Payment.Current) {
            c.payment = Types.Payment.Matured;
            c.revision = RevisionLib.next(c.revision);
        }
    }

    function markDefaulted(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (block.timestamp <= c.maturity + c.grace || c.payment == Types.Payment.Repaid) revert BadState();
        _accrue(c, creditId);
        if (c.debt == 0) revert BadState();
        c.payment = Types.Payment.Defaulted;
        c.revision = RevisionLib.next(c.revision);
    }

    function startClosing(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.borrower || c.facility != Types.Facility.Ready) revert BadState();
        _accrue(c, creditId);
        if (c.debt != 0) revert BadState();
        if (c.vault != address(0)) {
            uint256 committed = IHouseVaultCore(c.vault).creditCommitted(creditId);
            if (committed > 0) IHouseVaultCore(c.vault).release(creditId, committed);
        }
        c.facility = Types.Facility.Closing;
        sessionGeneration[creditId] += 1;
        c.revision = RevisionLib.next(c.revision);
    }

    function finishClose(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (c.facility != Types.Facility.Closing || c.debt != 0 || !c.collateralReturned) revert BadState();
        _requireExitReady(c, creditId);
        if (ICreditAccountCore(c.account).tokenBalance(IHouseVaultCore(c.vault).asset()) != 0) revert BadState();
        c.facility = Types.Facility.Closed;
        emit Events.Closed(creditId);
    }

    function _requireExitReady(Credit storage c, bytes32 creditId) internal view {
        address verifier = exitVerifierOfBundle[c.bundleId];
        if (verifier == address(0) || verifier.codehash != exitVerifierCodeHash[c.bundleId]) revert BadState();
        try IExitVerifier(verifier).canExit(creditId, c.account) returns (bool ready) {
            if (!ready) revert BadState();
        } catch {
            revert BadState();
        }
    }

    function startLiquidation(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (c.facility != Types.Facility.Ready) revert BadState();
        _accrue(c, creditId);
        if (
            c.payment != Types.Payment.Defaulted
                && (riskEngine == address(0) || !_isLiquidatableWithFreshHealth(c, creditId))
        ) revert BadState();
        c.facility = Types.Facility.Liquidating;
        sessionGeneration[creditId] += 1;
        c.revision = RevisionLib.next(c.revision);
        if (c.vault != address(0)) {
            uint256 committed = IHouseVaultCore(c.vault).creditCommitted(creditId);
            if (committed > 0) IHouseVaultCore(c.vault).release(creditId, committed);
        }
        emit Events.LiquidationStarted(creditId);
    }

    function recordRecovery(bytes32 creditId, uint256 amount) external {
        Credit storage c = _credits[creditId];
        if (
            msg.sender != c.vault
                || (c.facility != Types.Facility.Liquidating && c.facility != Types.Facility.RecoveryPending)
                || amount == 0
        ) revert Unauthorized();
        c.recovery += amount;
        c.facility = Types.Facility.RecoveryPending;
        c.revision = RevisionLib.next(c.revision);
    }

    function recoverAccountCash(bytes32 creditId, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (!recoveryKeepers[msg.sender]) revert Unauthorized();
        if (c.facility != Types.Facility.Liquidating && c.facility != Types.Facility.RecoveryPending) {
            revert BadState();
        }
        _repay(c, creditId, amount, true);
    }

    function recoverCollateral(bytes32 creditId, uint256 amount) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (!recoveryKeepers[msg.sender]) revert Unauthorized();
        if (
            (c.facility != Types.Facility.Liquidating && c.facility != Types.Facility.RecoveryPending)
                || remoteCollateral[creditId] || c.collateralVault == address(0) || c.lockId == bytes32(0)
        ) revert BadState();
        _accrue(c, creditId);
        if (
            amount == 0 || amount > c.collateralAmount || amount > c.debt
                || c.collateralAsset != IHouseVaultCore(c.vault).asset()
        ) revert InvalidCollateral();
        ICollateralVaultCore(c.collateralVault).seize(c.lockId, c.vault, amount);
        _applyCollateralRecovery(c, creditId, amount, amount);
    }

    function recoverLocalCollateralWithBid(bytes32 creditId, uint256 collateralAmount, uint256 settlementAmount)
        external
        nonReentrant
    {
        Credit storage c = _credits[creditId];
        if (
            (c.facility != Types.Facility.Liquidating && c.facility != Types.Facility.RecoveryPending)
                || remoteCollateral[creditId] || c.collateralVault == address(0) || c.lockId == bytes32(0)
        ) revert BadState();
        _accrue(c, creditId);
        address settlementAsset = IHouseVaultCore(c.vault).asset();
        if (c.collateralAsset == settlementAsset || collateralAmount == 0 || collateralAmount > c.collateralAmount
            || settlementAmount == 0 || settlementAmount > c.debt) revert InvalidCollateral();
        (LocalSalePolicy memory policy, uint256 price) = _requireLocalSalePolicy(c.collateralAsset, settlementAsset);
        if (collateralAmount > policy.maxCollateralPerSale) revert InvalidCollateral();
        uint256 fairValue = _mulDivUp(collateralAmount, price, 10 ** policy.collateralDecimals);
        uint256 fairSettlement = _mulDivUp(fairValue, 10 ** policy.settlementDecimals, 1e18);
        uint256 minimumBid = _mulDivUp(fairSettlement, policy.minimumPriceBps, BPS);
        if (settlementAmount < minimumBid) revert InvalidCollateral();

        uint256 beforeHouse = settlementAsset.balanceOf(c.vault);
        settlementAsset.safeTransferFrom(msg.sender, c.vault, settlementAmount);
        if (settlementAsset.balanceOf(c.vault) - beforeHouse != settlementAmount) revert InvalidCollateral();
        uint256 beforeBuyer = c.collateralAsset.balanceOf(msg.sender);
        ICollateralVaultCore(c.collateralVault).seize(c.lockId, msg.sender, collateralAmount);
        if (c.collateralAsset.balanceOf(msg.sender) - beforeBuyer != collateralAmount) revert InvalidCollateral();
        _applyCollateralRecovery(c, creditId, settlementAmount, collateralAmount);
        emit LocalCollateralSold(creditId, msg.sender, collateralAmount, settlementAmount);
    }

    function _mulDivUp(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256) {
        uint256 product = a * b;
        return product == 0 ? 0 : (product - 1) / denominator + 1;
    }

    function _applyCollateralRecovery(Credit storage c, bytes32 creditId, uint256 settlementAmount, uint256 collateralAmount)
        internal
    {
        uint256 remaining = settlementAmount;
        uint256 feePaid = remaining > c.accruedFees ? c.accruedFees : remaining;
        remaining -= feePaid;
        uint256 interestPaid = remaining > c.accruedInterest ? c.accruedInterest : remaining;
        remaining -= interestPaid;
        uint256 principalPaid = remaining;
        if (principalPaid > c.principal) revert BadState();
        c.accruedFees -= feePaid;
        c.accruedInterest -= interestPaid;
        c.principal -= principalPaid;
        IHouseVaultCore(c.vault).receiveRepay(creditId, settlementAmount, principalPaid, interestPaid, feePaid);
        c.debt -= settlementAmount;
        c.collateralAmount -= collateralAmount;
        c.recovery += settlementAmount;
        c.facility = Types.Facility.RecoveryPending;
        c.revision = RevisionLib.next(c.revision);
        if (c.debt == 0) c.payment = Types.Payment.Repaid;
        emit Events.RecoveryPayment(creditId, settlementAmount, c.debt);
    }

    function cure(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (c.facility != Types.Facility.RecoveryPending) revert BadState();
        if (
            block.timestamp >= c.maturity || c.payment == Types.Payment.Defaulted || c.recoveryFinalized
                || pendingRemoteSeizure[creditId] != 0 || pendingRemoteReturn[creditId] != 0
                || remoteSeizureConfirmed[creditId]
        ) {
            revert BadState();
        }
        _accrue(c, creditId);
        if (c.debt != 0) {
            if (riskEngine == address(0)) revert BadHealth();
            _requireFreshHealth(c, creditId);
            Types.HealthSnapshot memory snapshot_ = IRiskCore(riskEngine).snapshot(creditId);
            uint256 maintenance = IRiskCore(riskEngine).maintenanceBps(creditId);
            if (maintenance == 0 || snapshot_.healthBps < maintenance) {
                revert BadHealth();
            }
        }
        if (c.vault != address(0)) {
            uint256 required =
                c.revolving ? (c.limit > c.debt ? c.limit - c.debt : 0) : (c.limit > c.drawn ? c.limit - c.drawn : 0);
            uint256 committed = IHouseVaultCore(c.vault).creditCommitted(creditId);
            if (required > committed) IHouseVaultCore(c.vault).reserve(creditId, required - committed);
            else if (committed > required) IHouseVaultCore(c.vault).release(creditId, committed - required);
        }
        c.facility = Types.Facility.Ready;
        c.payment = Types.Payment.Current;
        c.revision = RevisionLib.next(c.revision);
        emit Events.Cured(creditId);
    }

    function finalizeRecovery(bytes32 creditId) external {
        Credit storage c = _credits[creditId];
        if (msg.sender != c.vault || c.facility != Types.Facility.RecoveryPending || pendingRemoteSeizure[creditId] != 0) revert Unauthorized();
        c.recoveryFinalized = true;
        c.revision = RevisionLib.next(c.revision);
    }

    function finishLiquidation(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        _accrue(c, creditId);
        if (c.facility != Types.Facility.RecoveryPending || !c.recoveryFinalized) {
            revert RecoveryIncomplete();
        }
        c.facility = Types.Facility.Liquidated;
        c.revision = RevisionLib.next(c.revision);
        emit Events.Liquidated(creditId);
    }

    function _isLiquidatableWithFreshHealth(Credit storage c, bytes32 creditId) internal view returns (bool) {
        _requireFreshHealth(c, creditId);
        return IRiskCore(riskEngine).riskState(creditId) == Types.Risk.Liquidatable;
    }

    function _requireFreshHealth(Credit storage c, bytes32 creditId)
        internal
        view
        returns (Types.HealthSnapshot memory snapshot)
    {
        if (
            riskEngine == address(0) || healthSnapshotAt[creditId] == 0
                || healthSnapshotRevision[creditId] != c.revision
                || block.timestamp > healthSnapshotAt[creditId] + healthMaxAge
        ) revert BadHealth();
        snapshot = IRiskCore(riskEngine).snapshot(creditId);
        if (snapshot.debt != c.debt) revert BadHealth();
    }

    function creditFacility(bytes32 creditId) external view returns (Types.Facility) {
        return _credits[creditId].facility;
    }

    function creditDebt(bytes32 creditId) external view returns (uint256) {
        return _previewDebt(_credits[creditId], creditId);
    }

    function creditVault(bytes32 creditId) external view returns (address) {
        return _credits[creditId].vault;
    }

    function remoteRecoveryContext(bytes32 creditId)
        external
        view
        returns (uint256 sourceChain, address sourceAsset, address recoveryVault)
    {
        sourceChain = collateralSourceChainOf[creditId];
        sourceAsset = _credits[creditId].collateralAsset;
        recoveryVault = remoteRecoveryVaultOf[creditId];
    }

    function creditRevision(bytes32 creditId) external view returns (uint256) {
        return _credits[creditId].revision;
    }

    function isReady(bytes32 creditId) external view returns (bool) {
        return _credits[creditId].facility == Types.Facility.Ready;
    }

    function creditAccount(bytes32 creditId) external view returns (address) {
        return _credits[creditId].account;
    }

    function creditDetails(bytes32 creditId) external view returns (Credit memory) {
        Credit memory c = _credits[creditId];
        (uint256 interest, uint256 fees) = _previewAccrual(c, creditId);
        c.accruedInterest += interest;
        c.accruedFees += fees;
        c.debt += interest + fees;
        return c;
    }
}
