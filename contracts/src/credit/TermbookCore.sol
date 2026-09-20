// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../shared/Types.sol";
import {Events} from "../shared/Events.sol";
import {RevisionLib} from "../shared/RevisionLib.sol";
import {AuthLib} from "../shared/AuthLib.sol";
import {SafeTransferLib} from "../shared/SafeTransferLib.sol";
import {ITermbookCore} from "./ITermbookCore.sol";

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
    function transferToken(address token, address to, uint256 amount) external;
    function tokenBalance(address token) external view returns (uint256);
}

interface IRiskCore {
    function riskState(bytes32 creditId) external view returns (Types.Risk);
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
        returns (address impl, uint256 version, bool active, uint256 maxAge);
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
    function headerRoot(bytes calldata header) external pure returns (bytes32);
    function proofLeaf(bytes calldata proof) external pure returns (bytes32);
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

    address public governance;
    address public guardian;
    address public riskEngine;
    address public integrationRegistry;
    address public verifierRegistry;
    address public houseRegistry;
    address public healthReporter;
    bytes32 public immutable domain;
    bool public paused;
    bool private entered;
    mapping(bytes32 => Credit) internal _credits;
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
    mapping(address => bool) public recoveryKeepers;

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
    uint256 private constant YEAR = 365 days;

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
        healthReporter = governance_;
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

    function setHouseRegistry(address registry) external onlyGovernance {
        if (registry == address(0) || registry.code.length == 0) revert InvalidAuthority();
        houseRegistry = registry;
    }

    function setHouseProtocolFee(address vault, address recipient, uint256 feeBps) external onlyGovernance {
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

    function setPaused(bool value) external {
        if (msg.sender != guardian && msg.sender != governance) revert Unauthorized();
        paused = value;
    }

    function setRisk(address risk) external onlyGovernance {
        riskEngine = risk;
    }

    function setHealthReporter(address reporter) external onlyGovernance {
        if (reporter == address(0)) revert InvalidTerms();
        healthReporter = reporter;
    }

    function setIntegrationRegistry(address registry) external onlyGovernance {
        integrationRegistry = registry;
    }

    function setVerifierRegistry(address registry) external onlyGovernance {
        verifierRegistry = registry;
    }

    function setApprovedCall(address target, bytes4 selector, bool active) external onlyGovernance {
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

    function recordHealth(bytes32 creditId, Types.HealthSnapshot calldata snapshot_) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (msg.sender != governance && msg.sender != healthReporter) revert Unauthorized();
        _accrue(c, creditId);
        if (snapshot_.debt != c.debt) revert BadHealth();
        if (riskEngine == address(0)) revert BadHealth();
        IRiskCore(riskEngine).record(creditId, snapshot_);
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
        houseNonces[p.house][p.houseNonce] = true;
        IHouseVaultCore(p.vault).reserve(p.creditId, p.limit);
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
        if (verifierRegistry == address(0)) return;
        (address impl, uint256 version, bool active,) = IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (!active || impl.code.length == 0 || version == 0) revert InvalidCollateral();
        c.verifierVersion = version;
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
            collateralAsset == address(0)
                || (!remote
                    && (collateralAsset.code.length == 0
                        || collateralVault.code.length == 0
                        || ICollateralVaultCore(collateralVault).core() != address(this)
                        || ICollateralVaultCore(collateralVault).asset() != collateralAsset
                        || ICollateralVaultCore(collateralVault).chainId_() != block.chainid))
        ) revert InvalidCollateral();
        collateralOwnerOf[creditId] = owner;
        collateralSourceChainOf[creditId] = sourceChain;
        c.collateralVault = collateralVault;
        c.collateralAsset = collateralAsset;
        c.collateralAmount = collateralAmount;
        c.returnRecipient = returnRecipient;
        remoteCollateral[creditId] = remote;
        if (remote) _pinVerifier(c, sourceChain);
        c.facility = remote ? Types.Facility.CollateralProving : Types.Facility.CollateralLocking;
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
        _setCollateral(creditId, msg.sender, returnRecipient, collateralVault, owner, true, sourceChain);
        if (sourceChain == 0 || sourceChain == block.chainid || collateralAsset == address(0) || collateralAmount == 0) revert InvalidCollateral();
        Credit storage c = _credits[creditId];
        c.collateralAsset = collateralAsset;
        c.collateralAmount = collateralAmount;
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
            if (collateralVault.code.length == 0 || ICollateralVaultCore(collateralVault).core() != address(this)) {
                revert InvalidCollateral();
            }
            sourceChain = ICollateralVaultCore(collateralVault).chainId_();
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
            c.facility != Types.Facility.CollateralLocking || !remoteCollateral[creditId] || c.collateralBound
                || lockId == bytes32(0)
        ) revert InvalidCollateral();
        c.lockId = lockId;
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
        if (
            (c.facility != Types.Facility.CollateralProving && c.facility != Types.Facility.Aborted)
                || !c.collateralBound || verifierRegistry == address(0)
        ) revert InvalidCollateral();
        uint256 expectedSourceChain = collateralSourceChainOf[creditId];
        if (expectedSourceChain == 0 || sourceChain != expectedSourceChain) revert InvalidCollateral();
        (address impl,, bool active,) = IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (!active || impl.code.length == 0) revert InvalidCollateral();
        (, uint256 version,,) = IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (c.verifierVersion == 0 || version != c.verifierVersion) revert InvalidCollateral();
        try IVerifierCore(impl).verifyFinality(header) returns (bool final_) {
            if (!final_) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        bytes32 root;
        try IVerifierCore(impl).headerRoot(header) returns (bytes32 root_) {
            root = root_;
        } catch {
            revert InvalidCollateral();
        }
        if (proof.length < 128) revert InvalidCollateral();
        address owner = collateralOwnerOf[creditId];
        bytes32 expected = keccak256(
            abi.encode(
                creditId,
                c.lockId,
                c.borrower,
                owner,
                c.collateralAsset,
                c.collateralAmount,
                sourceChain,
                c.returnRecipient
            )
        );
        bytes32 leaf;
        try IVerifierCore(impl).proofLeaf(proof) returns (bytes32 leaf_) {
            leaf = leaf_;
        } catch {
            revert InvalidCollateral();
        }
        bool included;
        try IVerifierCore(impl).verifyInclusion(proof, root) returns (bool included_) {
            included = included_;
        } catch {
            revert InvalidCollateral();
        }
        if (leaf != expected || !included) revert InvalidCollateral();
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
        if (
            msg.sender != c.borrower || c.debt != 0
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
        if (
            msg.sender != c.borrower || (c.facility != Types.Facility.Closing && c.facility != Types.Facility.Aborted)
                || lockId != c.lockId || c.collateralReturned
        ) revert Unauthorized();
        if (amount == 0 || amount > c.collateralAmount) revert InvalidCollateral();
        if (remoteCollateral[creditId]) {
            uint256 available = c.collateralAmount - pendingRemoteReturn[creditId];
            if (amount > available) revert InvalidCollateral();
            pendingRemoteReturn[creditId] += amount;
            c.revision = RevisionLib.next(c.revision);
            emit Events.RemoteReturnRequested(creditId, lockId, amount, c.returnRecipient);
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

    function confirmRemoteReturn(bytes32 creditId, bytes calldata header, bytes calldata proof) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (
            (c.facility != Types.Facility.Closing && c.facility != Types.Facility.Aborted)
                || !remoteCollateral[creditId] || pendingRemoteReturn[creditId] == 0 || verifierRegistry == address(0)
        ) revert Pending();
        uint256 sourceChain = collateralSourceChainOf[creditId];
        (address impl,, bool active,) = IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (!active || impl.code.length == 0) revert InvalidCollateral();
        (, uint256 version,,) = IVerifierRegistryCore(verifierRegistry).verifiers(sourceChain);
        if (c.verifierVersion == 0 || version != c.verifierVersion) revert InvalidCollateral();
        try IVerifierCore(impl).verifyFinality(header) returns (bool final_) {
            if (!final_) revert InvalidCollateral();
        } catch {
            revert InvalidCollateral();
        }
        bytes32 root;
        try IVerifierCore(impl).headerRoot(header) returns (bytes32 root_) {
            root = root_;
        } catch {
            revert InvalidCollateral();
        }
        bytes32 leaf;
        try IVerifierCore(impl).proofLeaf(proof) returns (bytes32 leaf_) {
            leaf = leaf_;
        } catch {
            revert InvalidCollateral();
        }
        uint256 amount = pendingRemoteReturn[creditId];
        bytes32 expected = keccak256(
            abi.encode(
                creditId,
                c.lockId,
                c.borrower,
                collateralOwnerOf[creditId],
                c.collateralAsset,
                amount,
                sourceChain,
                c.returnRecipient,
                bytes32("release")
            )
        );
        bool included;
        try IVerifierCore(impl).verifyInclusion(proof, root) returns (bool included_) {
            included = included_;
        } catch {
            revert InvalidCollateral();
        }
        if (leaf != expected || !included) revert InvalidCollateral();
        pendingRemoteReturn[creditId] = 0;
        c.collateralAmount -= amount;
        if (c.collateralAmount == 0) {
            c.collateralReturned = true;
            lockReturned[creditId][c.lockId] = true;
        }
        c.revision = RevisionLib.next(c.revision);
        emit Events.CollateralReturned(creditId, c.lockId, amount);
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
            Types.HealthSnapshot memory snapshot = IRiskCore(riskEngine).snapshot(creditId);
            if (c.debt > 0 && snapshot.debt != c.debt) revert BadHealth();
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
        _draw(c, creditId, amount, maxBound, borrowerNonce, borrowerNonce);
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
        _draw(c, creditId, amount, maxBound, nonceKey, sessionNonce);
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
            _draw(c, creditId, amount, maxBound, borrowerNonce, borrowerNonce);
        } else {
            nonceUsed[creditId][borrowerNonce] = true;
            c.nonce = borrowerNonce;
            c.revision = RevisionLib.next(c.revision);
        }
        result = ICreditAccountCore(c.account).execute(target, data);
    }

    function _draw(
        Credit storage c,
        bytes32 creditId,
        uint256 amount,
        uint256 maxBound,
        uint256 nonceKey,
        uint256 recordedNonce
    ) internal {
        if (amount == 0 || amount > maxBound) revert OverLimit();
        _accrue(c, creditId);
        uint256 capacity =
            c.revolving ? (c.limit > c.debt ? c.limit - c.debt : 0) : (c.limit > c.drawn ? c.limit - c.drawn : 0);
        if (amount > capacity) revert OverLimit();
        if (riskEngine == address(0)) revert BadHealth();
        uint256 originationFee;
        if (!c.originationCharged && c.originationFee > 0) {
            originationFee = c.originationFee;
            c.originationCharged = true;
        }
        IRiskCore(riskEngine).checkDraw(creditId, c.debt + amount + originationFee);
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
        if (fromAccount) ICreditAccountCore(c.account).transferToken(token, c.vault, amount);
        else token.safeTransferFrom(msg.sender, c.vault, amount);
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
        if (c.facility == Types.Facility.Liquidating || c.facility == Types.Facility.RecoveryPending) {
            c.recovery += amount;
            c.facility = Types.Facility.RecoveryPending;
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
        if (c.facility == Types.Facility.Liquidating || c.facility == Types.Facility.RecoveryPending) {
            c.recovery += amount;
            c.facility = Types.Facility.RecoveryPending;
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
        _accrue(c, creditId);
        if (token != IHouseVaultCore(c.vault).asset()) revert InvalidTerms();
        uint256 balance = ICreditAccountCore(c.account).tokenBalance(token);
        if (amount == 0 || amount > balance) revert OverLimit();
        uint256 cashAfter;
        if (riskEngine != address(0)) {
            Types.HealthSnapshot memory snapshot = IRiskCore(riskEngine).snapshot(creditId);
            if (c.debt > 0 && snapshot.debt != c.debt) revert BadHealth();
            cashAfter = snapshot.cash > amount ? snapshot.cash - amount : 0;
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
        c.facility = Types.Facility.Closed;
        emit Events.Closed(creditId);
    }

    function startLiquidation(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (c.facility != Types.Facility.Ready) revert BadState();
        _accrue(c, creditId);
        if (
            c.payment != Types.Payment.Defaulted
                && (riskEngine == address(0) || IRiskCore(riskEngine).riskState(creditId) != Types.Risk.Liquidatable)
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
        c.debt -= amount;
        c.collateralAmount -= amount;
        c.recovery += amount;
        c.facility = Types.Facility.RecoveryPending;
        c.revision = RevisionLib.next(c.revision);
        if (c.debt == 0) c.payment = Types.Payment.Repaid;
        emit Events.RecoveryPayment(creditId, amount, c.debt);
    }

    function cure(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        if (c.facility != Types.Facility.RecoveryPending) revert BadState();
        if (block.timestamp >= c.maturity || c.payment == Types.Payment.Defaulted) revert BadState();
        _accrue(c, creditId);
        if (c.debt != 0) {
            if (riskEngine == address(0)) revert BadHealth();
            Types.HealthSnapshot memory snapshot = IRiskCore(riskEngine).snapshot(creditId);
            if (snapshot.debt != c.debt || IRiskCore(riskEngine).riskState(creditId) != Types.Risk.Healthy) {
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
        if (msg.sender != c.vault || c.facility != Types.Facility.RecoveryPending) revert Unauthorized();
        c.recoveryFinalized = true;
        c.revision = RevisionLib.next(c.revision);
    }

    function finishLiquidation(bytes32 creditId) external nonReentrant {
        Credit storage c = _credits[creditId];
        _accrue(c, creditId);
        if (c.facility != Types.Facility.RecoveryPending || (!c.recoveryFinalized && c.debt != 0)) {
            revert RecoveryIncomplete();
        }
        c.facility = Types.Facility.Liquidated;
        c.revision = RevisionLib.next(c.revision);
        emit Events.Liquidated(creditId);
    }

    function creditFacility(bytes32 creditId) external view returns (Types.Facility) {
        return _credits[creditId].facility;
    }

    function creditDebt(bytes32 creditId) external view returns (uint256) {
        return _previewDebt(_credits[creditId], creditId);
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
