// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHouseVault} from "./IHouseVault.sol";
import {SafeTransferLib} from "../../shared/SafeTransferLib.sol";
import {RecoveryReserve} from "./RecoveryReserve.sol";

interface ISettlementInboxView {
    function operationId() external view returns (bytes32);
    function vault() external view returns (address);
    function token() external view returns (address);
    function creditId() external view returns (bytes32);
    function refundRecipient() external view returns (address);
    function lpMinShares() external view returns (uint256);
}

interface IInboxFactoryView {
    function inboxOf(bytes32 operationId) external view returns (address);
}

interface ISettlementCore {
    function applySettlement(bytes32 creditId, address inbox, uint256 amount) external;
    function previewVaultAccrual(bytes32 creditId) external view returns (uint256);
    function creditDebt(bytes32 creditId) external view returns (uint256);
    function creditFacility(bytes32 creditId) external view returns (uint8);
    function commitFullRecovery(bytes32 creditId) external;
    function finalizeRecovery(bytes32 creditId) external;
    function finishLiquidation(bytes32 creditId) external;
}

contract HouseVault is IHouseVault {
    using SafeTransferLib for address;

    struct Withdrawal {
        address owner;
        address recipient;
        uint256 shares;
        uint256 amount;
        bool claimed;
        bool cancelled;
    }

    struct VotingCheckpoint {
        uint256 blockNumber;
        uint256 timestamp;
        uint256 matured;
        uint256 pending;
        uint256 pendingMatureAt;
    }

    struct ShareCheckpoint { uint256 sequence; uint256 balance; }
    struct Loss {
        uint256 sequence;
        uint256 shares;
        uint256 uncovered;
        uint256 recovered;
        uint256 covered;
    }

    address public immutable asset;
    address public immutable core;
    address public immutable manager;
    address public immutable inboxFactory;
    RecoveryReserve public immutable recoveryReserve;
    address public pauseGuardian;
    uint256 public freeCash;
    uint256 public committedCash;
    uint256 public drawnPrincipal;
    uint256 public accruedReceivables;
    uint256 public pendingSettlement;
    uint256 public impairment;
    uint256 public bondLiabilities;
    uint256 public bondCash;
    uint256 public protocolFeeBps;
    uint256 public protocolFeesPaid;
    uint256 public protocolFeeRemainder;
    address public protocolFeeRecipient;
    uint256 public totalShares;
    uint256 public constant GOVERNANCE_HOLD = 1 days;
    bool public depositsOpen = true;
    bool public paused;
    uint256 private constant SCALE = 1e18;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public governanceShares;
    mapping(address => uint256) public pendingGovernanceShares;
    mapping(address => uint256) public governanceSharesMatureAt;
    mapping(address => VotingCheckpoint[]) private votingCheckpoints;
    mapping(bytes32 => uint256) public creditCommitted;
    mapping(bytes32 => uint256) public creditDrawn;
    mapping(bytes32 => uint256) public creditAccruedReceivable;
    mapping(address => bool) public settlementInboxes;
    mapping(address => uint256) public pendingByInbox;
    mapping(bytes32 => uint256) public pendingByCredit;
    mapping(bytes32 => uint256) public bondByCredit;
    mapping(address => address) public lpInboxRecipient;
    mapping(address => uint256) public lpInboxMinShares;
    mapping(address => bool) public lpInboxMinted;
    mapping(uint256 => Withdrawal) public withdrawals;
    uint256 public withdrawalNonce;
    uint256 public queuedWithdrawalShares;
    uint256 public withdrawalHead;
    uint256 public withdrawalTail;
    uint256 public constant MAX_ACTIVE_CREDITS = 64;
    bytes32[] public activeCredits;
    mapping(bytes32 => uint256) private activeCreditIndex;
    mapping(uint256 => uint256) private withdrawalNext;
    mapping(uint256 => uint256) private withdrawalPrevious;
    uint256 public shareSequence;
    uint256 public lateRecoveryCash;
    uint256 public unresolvedCreditImpairment;
    bool private entered;
    mapping(address => uint256) public economicShares;
    mapping(address => ShareCheckpoint[]) private shareCheckpoints;
    mapping(bytes32 => Loss) public losses;
    mapping(bytes32 => bool) public creditWrittenOff;
    mapping(bytes32 => uint256) public contingentPrincipal;
    mapping(bytes32 => uint256) public contingentReceivables;
    mapping(bytes32 => uint256) public creditImpairment;
    mapping(bytes32 => mapping(address => uint256)) public recoveryClaimed;

    error Unauthorized();
    error Closed();
    error Insufficient();
    error Expired();
    error Slippage();
    error InvalidAmount();
    error InvalidAsset();
    error InvalidAccount();
    error InvalidInbox();
    error AccountingMismatch();
    error InvalidShares();

    event Deposited(address indexed payer, address indexed recipient, uint256 amount, uint256 shares);
    event Withdrawn(address indexed owner, uint256 amount, uint256 shares);
    event Reserved(bytes32 indexed creditId, uint256 amount);
    event Released(bytes32 indexed creditId, uint256 amount);
    event DrawFunded(bytes32 indexed creditId, address indexed account, uint256 amount);
    event RepaymentReceived(bytes32 indexed creditId, uint256 amount);
    event SettlementInboxSet(address indexed inbox, bool active);
    event WithdrawalQueued(
        uint256 indexed withdrawalId, address indexed owner, address recipient, uint256 shares, uint256 amount
    );
    event WithdrawalClaimed(uint256 indexed withdrawalId, address indexed recipient, uint256 amount);
    event WithdrawalCancelled(uint256 indexed withdrawalId, address indexed owner, uint256 shares);
    event PauseGuardianSet(address indexed guardian);
    event ProtocolFeeSet(address indexed recipient, uint256 feeBps);
    event ProtocolFeePaid(bytes32 indexed creditId, address indexed recipient, uint256 amount);
    event CreditWrittenOff(bytes32 indexed creditId, uint256 loss, uint256 coverage, uint256 lpLoss);
    event LateRecoveryReceived(bytes32 indexed creditId, uint256 lpAmount, uint256 protectionAmount);
    event LateRecoveryClaimed(bytes32 indexed creditId, address indexed owner, uint256 amount);
    event CreditImpairmentSet(bytes32 indexed creditId, uint256 amount);

    constructor(address asset_, address core_, address manager_, address inboxFactory_, address pauseGuardian_) {
        if (
            asset_.code.length == 0 || core_ == address(0) || manager_ == address(0)
                || (inboxFactory_ != address(0) && inboxFactory_.code.length == 0)
                || (pauseGuardian_ != address(0) && pauseGuardian_.code.length == 0)
        ) revert InvalidAsset();
        asset = asset_;
        core = core_;
        manager = manager_;
        inboxFactory = inboxFactory_;
        pauseGuardian = pauseGuardian_;
        recoveryReserve = new RecoveryReserve(asset_, address(this), manager_);
    }

    modifier onlyCore() {
        if (msg.sender != core) revert Unauthorized();
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    modifier guarded() {
        if (entered) revert Unauthorized();
        entered = true;
        _;
        entered = false;
    }

    function fundedReserves() external view returns (uint256) { return recoveryReserve.reserves(); }

    function setDepositsOpen(bool value) external onlyManager {
        depositsOpen = value;
    }

    function setPauseGuardian(address guardian) external onlyManager {
        if (guardian == address(0) || guardian.code.length == 0) revert Unauthorized();
        pauseGuardian = guardian;
        emit PauseGuardianSet(guardian);
    }

    function setProtocolFee(address recipient, uint256 feeBps) external onlyCore {
        if (feeBps > 10_000 || (feeBps > 0 && recipient == address(0))) revert InvalidAmount();
        protocolFeeRecipient = recipient;
        protocolFeeBps = feeBps;
        emit ProtocolFeeSet(recipient, feeBps);
    }

    function setPaused(bool value) external {
        if (msg.sender != manager && msg.sender != core && msg.sender != pauseGuardian) revert Unauthorized();
        paused = value;
    }

    function setSettlementInbox(address inbox, bool active) external onlyManager {
        if (inbox == address(0)) revert InvalidInbox();
        if (active) {
            if (inboxFactory == address(0) || inbox.code.length == 0) revert InvalidInbox();
            if (ISettlementInboxView(inbox).vault() != address(this)) revert InvalidInbox();
            if (ISettlementInboxView(inbox).token() != asset) revert InvalidInbox();
            if (IInboxFactoryView(inboxFactory).inboxOf(ISettlementInboxView(inbox).operationId()) != inbox) {
                revert InvalidInbox();
            }
        }
        settlementInboxes[inbox] = active;
        emit SettlementInboxSet(inbox, active);
    }

    function registerInboxFromFactory(address inbox, uint8 kind, address recipient, uint256 minShares) external {
        if (msg.sender != inboxFactory || inbox.code.length == 0 || settlementInboxes[inbox]) revert InvalidInbox();
        if (ISettlementInboxView(inbox).vault() != address(this) || ISettlementInboxView(inbox).token() != asset) {
            revert InvalidInbox();
        }
        if (IInboxFactoryView(inboxFactory).inboxOf(ISettlementInboxView(inbox).operationId()) != inbox) {
            revert InvalidInbox();
        }
        bytes32 creditId = ISettlementInboxView(inbox).creditId();
        if (kind == 2) {
            if (creditId != bytes32(0) || recipient == address(0) || minShares == 0) revert InvalidInbox();
            lpInboxRecipient[inbox] = recipient;
            lpInboxMinShares[inbox] = minShares;
        } else if (kind > 1 || creditId == bytes32(0) || recipient != address(0) || minShares != 0) {
            revert InvalidInbox();
        }
        settlementInboxes[inbox] = true;
        emit SettlementInboxSet(inbox, true);
    }

    function configureLpInbox(address inbox, address recipient, uint256 minShares) external {
        if (
            !settlementInboxes[inbox] || recipient == address(0) || minShares == 0 || lpInboxMinted[inbox]
                || lpInboxRecipient[inbox] != address(0) || ISettlementInboxView(inbox).creditId() != bytes32(0)
                || msg.sender != ISettlementInboxView(inbox).refundRecipient()
        ) revert InvalidInbox();
        lpInboxRecipient[inbox] = recipient;
        lpInboxMinShares[inbox] = minShares;
    }

    function setCreditImpairment(bytes32 creditId, uint256 amount) external onlyManager {
        if (activeCreditIndex[creditId] == 0 || creditWrittenOff[creditId]) revert InvalidAccount();
        uint256 face = creditDrawn[creditId] + creditAccruedReceivable[creditId]
            + ISettlementCore(core).previewVaultAccrual(creditId);
        if (amount > face) revert InvalidAmount();
        impairment = impairment - creditImpairment[creditId] + amount;
        unresolvedCreditImpairment = unresolvedCreditImpairment - creditImpairment[creditId] + amount;
        creditImpairment[creditId] = amount;
        emit CreditImpairmentSet(creditId, amount);
    }

    function finalizeRecovery(bytes32 creditId) external onlyManager guarded {
        ISettlementCore(core).commitFullRecovery(creditId);
        ISettlementCore(core).finalizeRecovery(creditId);
        ISettlementCore(core).finishLiquidation(creditId);
    }

    function creditFundingOpen(bytes32 creditId) external view returns (bool) {
        return activeCreditIndex[creditId] != 0 && !creditWrittenOff[creditId];
    }

    function activeCreditCount() external view returns (uint256) { return activeCredits.length; }

    function protectionRefundable(bytes32 creditId) external view returns (bool) {
        uint8 facility = ISettlementCore(core).creditFacility(creditId);
        return (facility == 6 || facility == 7 || facility == 10) && ISettlementCore(core).creditDebt(creditId) == 0;
    }

    function writeOff(bytes32 creditId, uint256 principal, uint256 receivables) external onlyCore {
        if (creditWrittenOff[creditId] || creditCommitted[creditId] != 0 || pendingByCredit[creditId] != 0
            || principal != creditDrawn[creditId] || receivables != creditAccruedReceivable[creditId]) revert AccountingMismatch();
        uint256 beforeAssets = totalAssets();
        creditWrittenOff[creditId] = true;
        contingentPrincipal[creditId] = principal;
        contingentReceivables[creditId] = receivables;
        drawnPrincipal -= principal;
        accruedReceivables -= receivables;
        creditDrawn[creditId] = 0;
        creditAccruedReceivable[creditId] = 0;
        impairment -= creditImpairment[creditId];
        unresolvedCreditImpairment -= creditImpairment[creditId];
        creditImpairment[creditId] = 0;
        uint256 afterAssets = totalAssets();
        uint256 loss = beforeAssets > afterAssets ? beforeAssets - afterAssets : 0;
        uint256 recognized = principal + receivables - receivables * protocolFeeBps / 10_000;
        if (recognized > loss) loss = recognized;
        uint256 beforeBalance = asset.balanceOf(address(this));
        uint256 covered = recoveryReserve.cover(creditId, loss);
        if (asset.balanceOf(address(this)) - beforeBalance != covered) revert AccountingMismatch();
        freeCash += covered;
        losses[creditId] = Loss(shareSequence, totalShares, loss - covered, 0, covered);
        _removeActiveCredit(creditId);
        emit CreditWrittenOff(creditId, loss, covered, loss - covered);
    }

    function economicSharesAt(address account, uint256 sequence) public view returns (uint256) {
        ShareCheckpoint[] storage checkpoints = shareCheckpoints[account];
        uint256 low;
        uint256 high = checkpoints.length;
        while (low < high) {
            uint256 middle = (low + high) / 2;
            if (checkpoints[middle].sequence <= sequence) low = middle + 1;
            else high = middle;
        }
        return low == 0 ? 0 : checkpoints[low - 1].balance;
    }

    function claimLateRecovery(bytes32 creditId) external guarded returns (uint256 amount) {
        Loss storage loss = losses[creditId];
        uint256 entitlement = loss.shares == 0 ? 0
            : economicSharesAt(msg.sender, loss.sequence) * loss.recovered / loss.shares;
        amount = entitlement - recoveryClaimed[creditId][msg.sender];
        if (amount == 0) revert InvalidAmount();
        recoveryClaimed[creditId][msg.sender] = entitlement;
        lateRecoveryCash -= amount;
        asset.safeTransfer(msg.sender, amount);
        emit LateRecoveryClaimed(creditId, msg.sender, amount);
    }

    function _writeShareCheckpoint(address owner, int256 delta) private {
        if (delta > 0) economicShares[owner] += uint256(delta);
        else economicShares[owner] -= uint256(-delta);
        shareCheckpoints[owner].push(ShareCheckpoint(++shareSequence, economicShares[owner]));
    }

    function deposit(address to, uint256 amount) external returns (uint256) {
        return depositBound(to, amount, 0, block.timestamp);
    }

    function depositBound(address to, uint256 amount, uint256 minShares, uint256 deadline)
        public
        guarded
        returns (uint256 minted)
    {
        if (!depositsOpen || paused || unresolvedCreditImpairment != 0) revert Closed();
        if (to == address(0)) revert Unauthorized();
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert Expired();
        uint256 price = sharePrice();
        minted = totalShares == 0 ? amount : amount * SCALE / price;
        if (minted == 0 || minted < minShares) revert Slippage();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert AccountingMismatch();
        freeCash += amount;
        totalShares += minted;
        shares[to] += minted;
        _writeShareCheckpoint(to, int256(minted));
        _addPendingGovernanceShares(to, minted);
        _writeVotingCheckpoint(to);
        emit Deposited(msg.sender, to, amount, minted);
    }

    function requestWithdraw(uint256 shareAmount) external returns (uint256 amount) {
        return _withdraw(msg.sender, msg.sender, shareAmount);
    }

    function requestWithdrawTo(uint256 shareAmount, address to) external returns (uint256 amount) {
        if (to == address(0)) revert Unauthorized();
        return _withdraw(msg.sender, to, shareAmount);
    }

    function _withdraw(address owner, address to, uint256 shareAmount) internal guarded returns (uint256 amount) {
        if (paused || unresolvedCreditImpairment != 0) revert Closed();
        if (shareAmount == 0 || shares[owner] < shareAmount) revert Insufficient();
        uint256 price = sharePrice();
        amount = shareAmount * price / SCALE;
        if (amount == 0 || amount > availableCash()) revert Insufficient();
        _removeGovernanceShares(owner, shareAmount);
        _writeVotingCheckpoint(owner);
        shares[owner] -= shareAmount;
        totalShares -= shareAmount;
        _writeShareCheckpoint(owner, -int256(shareAmount));
        freeCash -= amount;
        uint256 beforeBalance = asset.balanceOf(to);
        asset.safeTransfer(to, amount);
        if (asset.balanceOf(to) - beforeBalance != amount) revert AccountingMismatch();
        emit Withdrawn(owner, amount, shareAmount);
    }

    function requestWithdrawQueued(uint256 shareAmount, address to)
        external
        guarded
        returns (uint256 withdrawalId, uint256 amount)
    {
        if (paused || to == address(0) || shareAmount == 0 || shares[msg.sender] < shareAmount) {
            revert Insufficient();
        }
        uint256 price = sharePrice();
        amount = shareAmount * price / SCALE;
        if (amount == 0) revert Insufficient();
        _removeGovernanceShares(msg.sender, shareAmount);
        _writeVotingCheckpoint(msg.sender);
        shares[msg.sender] -= shareAmount;
        withdrawalId = ++withdrawalNonce;
        queuedWithdrawalShares += shareAmount;
        if (withdrawalTail == 0) withdrawalHead = withdrawalId;
        else withdrawalNext[withdrawalTail] = withdrawalId;
        withdrawalPrevious[withdrawalId] = withdrawalTail;
        withdrawalTail = withdrawalId;
        withdrawals[withdrawalId] = Withdrawal(msg.sender, to, shareAmount, amount, false, false);
        emit WithdrawalQueued(withdrawalId, msg.sender, to, shareAmount, amount);
    }

    function claimWithdrawal(uint256 withdrawalId) external guarded returns (uint256 amount) {
        if (unresolvedCreditImpairment != 0) revert Closed();
        Withdrawal storage withdrawal = withdrawals[withdrawalId];
        if (withdrawal.owner != msg.sender || withdrawal.claimed || withdrawal.cancelled
            || withdrawalId != withdrawalHead) revert Insufficient();
        amount = withdrawal.shares * sharePrice() / SCALE;
        if (amount == 0 || amount > freeCash) revert Insufficient();
        withdrawal.claimed = true;
        queuedWithdrawalShares -= withdrawal.shares;
        totalShares -= withdrawal.shares;
        _writeShareCheckpoint(withdrawal.owner, -int256(withdrawal.shares));
        _removeWithdrawal(withdrawalId);
        freeCash -= amount;
        uint256 beforeBalance = asset.balanceOf(withdrawal.recipient);
        asset.safeTransfer(withdrawal.recipient, amount);
        if (asset.balanceOf(withdrawal.recipient) - beforeBalance != amount) revert AccountingMismatch();
        emit WithdrawalClaimed(withdrawalId, withdrawal.recipient, amount);
    }

    function cancelWithdrawal(uint256 withdrawalId) external guarded returns (uint256 shareAmount) {
        Withdrawal storage withdrawal = withdrawals[withdrawalId];
        if (withdrawal.owner != msg.sender || withdrawal.claimed || withdrawal.cancelled) revert Unauthorized();
        withdrawal.cancelled = true;
        shareAmount = withdrawal.shares;
        queuedWithdrawalShares -= shareAmount;
        shares[msg.sender] += shareAmount;
        _removeWithdrawal(withdrawalId);
        _addPendingGovernanceShares(msg.sender, shareAmount);
        _writeVotingCheckpoint(msg.sender);
        emit WithdrawalCancelled(withdrawalId, msg.sender, shareAmount);
    }

    function _removeWithdrawal(uint256 withdrawalId) internal {
        uint256 previous = withdrawalPrevious[withdrawalId];
        uint256 next = withdrawalNext[withdrawalId];
        if (previous == 0) withdrawalHead = next;
        else withdrawalNext[previous] = next;
        if (next == 0) withdrawalTail = previous;
        else withdrawalPrevious[next] = previous;
        delete withdrawalPrevious[withdrawalId];
        delete withdrawalNext[withdrawalId];
    }

    function registerCredit(bytes32 creditId) external onlyCore {
        if (creditId == bytes32(0) || activeCreditIndex[creditId] != 0
            || activeCredits.length >= MAX_ACTIVE_CREDITS) revert InvalidAccount();
        activeCredits.push(creditId);
        activeCreditIndex[creditId] = activeCredits.length;
    }

    function unregisterCredit(bytes32 creditId) external onlyCore {
        uint256 index = activeCreditIndex[creditId];
        if (index == 0 || creditDrawn[creditId] != 0 || creditAccruedReceivable[creditId] != 0
            || creditCommitted[creditId] != 0 || bondByCredit[creditId] != 0 || pendingByCredit[creditId] != 0) {
            revert AccountingMismatch();
        }
        _removeActiveCredit(creditId);
    }

    function _removeActiveCredit(bytes32 creditId) private {
        uint256 index = activeCreditIndex[creditId];
        if (index == 0) return;
        bytes32 last = activeCredits[activeCredits.length - 1];
        activeCredits[index - 1] = last;
        activeCreditIndex[last] = index;
        activeCredits.pop();
        delete activeCreditIndex[creditId];
    }

    function pendingAccrual() public view returns (uint256 amount) {
        for (uint256 i; i < activeCredits.length; ++i) {
            amount += ISettlementCore(core).previewVaultAccrual(activeCredits[i]);
        }
    }

    function reserve(bytes32 creditId, uint256 amount) public onlyCore {
        if (creditId == bytes32(0) || amount == 0 || amount > availableCash()) revert Insufficient();
        freeCash -= amount;
        committedCash += amount;
        creditCommitted[creditId] += amount;
        emit Reserved(creditId, amount);
    }

    function reserve(uint256 amount) external onlyCore {
        reserve(bytes32(uint256(1)), amount);
    }

    function release(bytes32 creditId, uint256 amount) public onlyCore {
        if (amount == 0 || amount > creditCommitted[creditId]) revert AccountingMismatch();
        creditCommitted[creditId] -= amount;
        committedCash -= amount;
        freeCash += amount;
        emit Released(creditId, amount);
    }

    function release(uint256 amount) external onlyCore {
        release(bytes32(uint256(1)), amount);
    }

    function fundDraw(bytes32 creditId, address account, uint256 amount) public onlyCore {
        if (creditId == bytes32(0) || account == address(0) || amount == 0) revert InvalidAccount();
        uint256 committed = creditCommitted[creditId];
        if (amount > committed) revert Insufficient();
        creditCommitted[creditId] = committed - amount;
        committedCash -= amount;
        uint256 beforeBalance = asset.balanceOf(account);
        drawnPrincipal += amount;
        creditDrawn[creditId] += amount;
        asset.safeTransfer(account, amount);
        if (asset.balanceOf(account) - beforeBalance != amount) revert AccountingMismatch();
        emit DrawFunded(creditId, account, amount);
    }

    function fundDraw(address account, uint256 amount) external onlyCore {
        fundDraw(bytes32(uint256(1)), account, amount);
    }

    function recordAccruedReceivable(bytes32 creditId, uint256 amount) external onlyCore {
        if (creditId == bytes32(0) || amount == 0) revert InvalidAmount();
        if (creditWrittenOff[creditId]) {
            contingentReceivables[creditId] += amount;
            return;
        }
        creditAccruedReceivable[creditId] += amount;
        accruedReceivables += amount;
    }

    function receiveRepay(bytes32 creditId, uint256 amount) public onlyCore {
        receiveRepay(creditId, amount, amount, 0, 0);
    }

    function receiveRepay(
        bytes32 creditId,
        uint256 amount,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 feePaid
    ) public onlyCore {
        if (amount == 0 || principalPaid + interestPaid + feePaid != amount) {
            revert AccountingMismatch();
        }
        if (creditWrittenOff[creditId]) {
            _receiveLateRecovery(creditId, amount, principalPaid, interestPaid + feePaid);
            return;
        }
        if (principalPaid > creditDrawn[creditId] || principalPaid > drawnPrincipal) revert AccountingMismatch();
        uint256 receivablePaid = interestPaid + feePaid;
        if (receivablePaid > creditAccruedReceivable[creditId] || receivablePaid > accruedReceivables) {
            revert AccountingMismatch();
        }
        creditDrawn[creditId] -= principalPaid;
        drawnPrincipal -= principalPaid;
        creditAccruedReceivable[creditId] -= receivablePaid;
        accruedReceivables -= receivablePaid;
        freeCash += amount;
        _payProtocolFee(creditId, receivablePaid);
        emit RepaymentReceived(creditId, amount);
    }

    function _payProtocolFee(bytes32 creditId, uint256 receivablePaid) private returns (uint256 protocolFee) {
        uint256 feeNumerator = receivablePaid * protocolFeeBps + protocolFeeRemainder;
        protocolFee = feeNumerator / 10_000;
        protocolFeeRemainder = feeNumerator % 10_000;
        if (protocolFee > 0) {
            freeCash -= protocolFee;
            protocolFeesPaid += protocolFee;
            asset.safeTransfer(protocolFeeRecipient, protocolFee);
            emit ProtocolFeePaid(creditId, protocolFeeRecipient, protocolFee);
        }
    }

    function _receiveLateRecovery(bytes32 creditId, uint256 amount, uint256 principalPaid, uint256 receivablePaid) private {
        if (principalPaid > contingentPrincipal[creditId] || receivablePaid > contingentReceivables[creditId]) {
            revert AccountingMismatch();
        }
        contingentPrincipal[creditId] -= principalPaid;
        contingentReceivables[creditId] -= receivablePaid;
        if (receivablePaid != 0 && contingentPrincipal[creditId] != 0) revert AccountingMismatch();
        freeCash += amount;
        uint256 fee = _payProtocolFee(creditId, receivablePaid);
        uint256 net = amount - fee;
        freeCash -= net;
        Loss storage loss = losses[creditId];
        uint256 lpAmount = net < loss.uncovered ? net : loss.uncovered;
        loss.uncovered -= lpAmount;
        uint256 protectionAmount;
        uint256 rest = net - lpAmount;
        if (rest != 0) {
            asset.safeApprove(address(recoveryReserve), rest);
            protectionAmount = recoveryReserve.restore(creditId, rest);
            asset.safeApprove(address(recoveryReserve), 0);
            loss.covered -= protectionAmount;
        }
        lpAmount += rest - protectionAmount;
        if (loss.shares == 0 && lpAmount != 0) revert AccountingMismatch();
        loss.recovered += lpAmount;
        lateRecoveryCash += lpAmount;
        emit LateRecoveryReceived(creditId, lpAmount, protectionAmount);
        emit RepaymentReceived(creditId, amount);
    }

    function receiveRepay(uint256 amount) external onlyCore {
        if (amount == 0 || amount > drawnPrincipal) revert AccountingMismatch();
        drawnPrincipal -= amount;
        freeCash += amount;
        emit RepaymentReceived(bytes32(uint256(1)), amount);
    }

    function creditAvailable(bytes32 creditId) external view returns (uint256) {
        return creditCommitted[creditId];
    }

    function restoreCommitment(bytes32 creditId, uint256 amount) external onlyCore {
        if (amount == 0 || amount > freeCash) revert Insufficient();
        freeCash -= amount;
        committedCash += amount;
        creditCommitted[creditId] += amount;
    }

    function availableCash() public view returns (uint256) {
        uint256 queuedAssets = queuedWithdrawalAssets();
        return freeCash > queuedAssets ? freeCash - queuedAssets : 0;
    }

    function queuedWithdrawalAssets() public view returns (uint256) {
        if (queuedWithdrawalShares == 0) return 0;
        return queuedWithdrawalShares * sharePrice() / SCALE;
    }

    function votingPower(address account) public view returns (uint256) {
        uint256 matured = governanceShares[account];
        if (pendingGovernanceShares[account] > 0 && block.timestamp >= governanceSharesMatureAt[account]) {
            matured += pendingGovernanceShares[account];
        }
        return matured;
    }

    function votingPowerAt(address account, uint256 snapshotBlock, uint256 snapshotTimestamp)
        external
        view
        returns (uint256)
    {
        VotingCheckpoint[] storage checkpoints = votingCheckpoints[account];
        if (checkpoints.length == 0) return 0;
        uint256 low;
        uint256 high = checkpoints.length;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (checkpoints[mid].blockNumber <= snapshotBlock) low = mid + 1;
            else high = mid;
        }
        if (low == 0) return 0;
        VotingCheckpoint storage checkpoint = checkpoints[low - 1];
        uint256 matured = checkpoint.matured;
        if (checkpoint.pending > 0 && checkpoint.pendingMatureAt <= snapshotTimestamp) {
            matured += checkpoint.pending;
        }
        return matured;
    }

    function _addPendingGovernanceShares(address account, uint256 amount) internal {
        _matureGovernanceShares(account);
        pendingGovernanceShares[account] += amount;
        governanceSharesMatureAt[account] = block.timestamp + GOVERNANCE_HOLD;
    }

    function _removeGovernanceShares(address account, uint256 amount) internal {
        _matureGovernanceShares(account);
        uint256 matured = governanceShares[account];
        if (matured >= amount) {
            governanceShares[account] = matured - amount;
            return;
        }
        governanceShares[account] = 0;
        uint256 pending = amount - matured;
        if (pendingGovernanceShares[account] < pending) revert AccountingMismatch();
        pendingGovernanceShares[account] -= pending;
        if (pendingGovernanceShares[account] == 0) governanceSharesMatureAt[account] = 0;
    }

    function _matureGovernanceShares(address account) internal {
        uint256 pending = pendingGovernanceShares[account];
        if (pending > 0 && block.timestamp >= governanceSharesMatureAt[account]) {
            governanceShares[account] += pending;
            pendingGovernanceShares[account] = 0;
            governanceSharesMatureAt[account] = 0;
        }
    }

    function _writeVotingCheckpoint(address account) internal {
        VotingCheckpoint[] storage checkpoints = votingCheckpoints[account];
        VotingCheckpoint memory checkpoint = VotingCheckpoint(
            block.number,
            block.timestamp,
            governanceShares[account],
            pendingGovernanceShares[account],
            governanceSharesMatureAt[account]
        );
        if (checkpoints.length > 0 && checkpoints[checkpoints.length - 1].blockNumber == block.number) {
            checkpoints[checkpoints.length - 1] = checkpoint;
        } else {
            checkpoints.push(checkpoint);
        }
    }

    function totalAssets() public view returns (uint256) {
        uint256 receivables = accruedReceivables + pendingAccrual();
        uint256 futureProtocolFee = (receivables * protocolFeeBps + protocolFeeRemainder) / 10_000;
        uint256 gross = freeCash + committedCash + drawnPrincipal + receivables - futureProtocolFee
            + pendingSettlement + bondCash;
        uint256 liabilities = bondLiabilities;
        if (gross <= impairment + liabilities) return 0;
        return gross - impairment - liabilities;
    }

    function sharePrice() public view returns (uint256) {
        if (totalShares == 0) return SCALE;
        return totalAssets() * SCALE / totalShares;
    }

    function applyRepaymentSettlement(bytes32 creditId, address inbox, uint256 amount) external onlyCore {
        applyRepaymentSettlement(creditId, inbox, amount, amount, 0, 0);
    }

    function applyRepaymentSettlement(
        bytes32 creditId,
        address inbox,
        uint256 amount,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 feePaid
    ) public onlyCore {
        if (
            !settlementInboxes[inbox] || amount == 0 || amount > pendingByInbox[inbox]
                || amount > pendingByCredit[creditId]
        ) revert AccountingMismatch();
        pendingByInbox[inbox] -= amount;
        pendingByCredit[creditId] -= amount;
        pendingSettlement -= amount;
        receiveRepay(creditId, amount, principalPaid, interestPaid, feePaid);
    }

    function collectBond(bytes32 creditId, address from, uint256 amount) external onlyCore {
        if (creditId == bytes32(0) || from == address(0) || amount == 0) revert InvalidAmount();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(from, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert AccountingMismatch();
        bondByCredit[creditId] += amount;
        bondCash += amount;
        bondLiabilities += amount;
    }

    function settleBond(bytes32 creditId, uint256 amount) external onlyCore {
        if (amount == 0) return;
        if (amount > bondByCredit[creditId] || amount > bondLiabilities) revert AccountingMismatch();
        bondByCredit[creditId] -= amount;
        bondCash -= amount;
        bondLiabilities -= amount;
        freeCash += amount;
    }

    function refundBond(bytes32 creditId, address recipient, uint256 amount) external onlyCore {
        if (recipient == address(0) || amount == 0 || amount > bondByCredit[creditId] || amount > bondLiabilities) {
            revert AccountingMismatch();
        }
        bondByCredit[creditId] -= amount;
        bondCash -= amount;
        bondLiabilities -= amount;
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert AccountingMismatch();
    }

    function onSettlement(bytes32 operationId, bytes32 creditId, address settlementToken, uint256 amount) external guarded {
        if (!settlementInboxes[msg.sender] || settlementToken != asset || amount == 0) revert Unauthorized();
        if (
            ISettlementInboxView(msg.sender).operationId() != operationId
                || ISettlementInboxView(msg.sender).creditId() != creditId
        ) revert InvalidInbox();
        // Require unaccounted tokens before crediting settlement.
        if (asset.balanceOf(address(this)) < freeCash + committedCash + bondCash + lateRecoveryCash + amount) {
            revert AccountingMismatch();
        }
        if (lpInboxRecipient[msg.sender] != address(0)) {
            if (!depositsOpen || paused || unresolvedCreditImpairment != 0) revert Closed();
            if (creditId != bytes32(0) || lpInboxMinted[msg.sender]) revert InvalidInbox();
            uint256 price = sharePrice();
            uint256 minted = totalShares == 0 ? amount : amount * SCALE / price;
            uint256 minShares = ISettlementInboxView(msg.sender).lpMinShares();
            if (minShares == 0) minShares = lpInboxMinShares[msg.sender];
            if (minted == 0 || minted < minShares) revert InvalidShares();
            lpInboxMinted[msg.sender] = true;
            freeCash += amount;
            totalShares += minted;
            shares[lpInboxRecipient[msg.sender]] += minted;
            _writeShareCheckpoint(lpInboxRecipient[msg.sender], int256(minted));
            _addPendingGovernanceShares(lpInboxRecipient[msg.sender], minted);
            _writeVotingCheckpoint(lpInboxRecipient[msg.sender]);
            emit Deposited(msg.sender, lpInboxRecipient[msg.sender], amount, minted);
            return;
        }
        if (creditId == bytes32(0)) revert InvalidInbox();
        pendingSettlement += amount;
        pendingByInbox[msg.sender] += amount;
        pendingByCredit[creditId] += amount;
        ISettlementCore(core).applySettlement(creditId, msg.sender, amount);
    }
}
