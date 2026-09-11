// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHouseVault} from "./IHouseVault.sol";
import {SafeTransferLib} from "../shared/SafeTransferLib.sol";

interface ISettlementInboxView {
    function vault() external view returns (address);
    function token() external view returns (address);
}

interface ISettlementCore {
    function applySettlement(bytes32 creditId, address inbox, uint256 amount) external;
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

    address public immutable asset;
    address public immutable core;
    address public immutable manager;
    uint256 public freeCash;
    uint256 public committedCash;
    uint256 public drawnPrincipal;
    uint256 public accruedReceivables;
    uint256 public pendingSettlement;
    uint256 public fundedReserves;
    uint256 public impairment;
    uint256 public bondLiabilities;
    uint256 public bondCash;
    uint256 public totalShares;
    bool public depositsOpen = true;
    bool public paused;
    uint256 private constant SCALE = 1e18;
    mapping(address => uint256) public shares;
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
    uint256 public queuedWithdrawalAssets;

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
    event ImpairmentRecognized(uint256 amount);
    event WithdrawalQueued(uint256 indexed withdrawalId, address indexed owner, address recipient, uint256 shares, uint256 amount);
    event WithdrawalClaimed(uint256 indexed withdrawalId, address indexed recipient, uint256 amount);
    event WithdrawalCancelled(uint256 indexed withdrawalId, address indexed owner, uint256 shares);

    constructor(address asset_, address core_, address manager_) {
        if (asset_.code.length == 0 || core_ == address(0) || manager_ == address(0)) revert InvalidAsset();
        asset = asset_;
        core = core_;
        manager = manager_;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert Unauthorized();
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    function setDepositsOpen(bool value) external onlyManager {
        depositsOpen = value;
    }

    function setPaused(bool value) external {
        if (msg.sender != manager && msg.sender != core) revert Unauthorized();
        paused = value;
    }

    function setSettlementInbox(address inbox, bool active) external onlyManager {
        if (inbox == address(0)) revert InvalidInbox();
        if (active) {
            if (inbox.code.length == 0) revert InvalidInbox();
            if (ISettlementInboxView(inbox).vault() != address(this)) revert InvalidInbox();
            if (ISettlementInboxView(inbox).token() != asset) revert InvalidInbox();
        }
        settlementInboxes[inbox] = active;
        emit SettlementInboxSet(inbox, active);
    }

    function configureLpInbox(address inbox, address recipient, uint256 minShares) external onlyManager {
        if (!settlementInboxes[inbox] || recipient == address(0) || lpInboxMinted[inbox]) revert InvalidInbox();
        lpInboxRecipient[inbox] = recipient;
        lpInboxMinShares[inbox] = minShares;
    }

    function recognizeImpairment(uint256 amount) external onlyManager {
        uint256 gross = freeCash + committedCash + drawnPrincipal + accruedReceivables + pendingSettlement;
        uint256 recognized;
        if (impairment < gross) {
            recognized = amount > gross - impairment ? gross - impairment : amount;
            impairment += recognized;
        }
        emit ImpairmentRecognized(recognized);
    }

    function deposit(address to, uint256 amount) external returns (uint256) {
        return depositBound(to, amount, 0, block.timestamp);
    }

    function depositBound(address to, uint256 amount, uint256 minShares, uint256 deadline)
        public
        returns (uint256 minted)
    {
        if (!depositsOpen || paused) revert Closed();
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
        emit Deposited(msg.sender, to, amount, minted);
    }

    function requestWithdraw(uint256 shareAmount) external returns (uint256 amount) {
        return _withdraw(msg.sender, msg.sender, shareAmount);
    }

    function requestWithdrawTo(uint256 shareAmount, address to) external returns (uint256 amount) {
        if (to == address(0)) revert Unauthorized();
        return _withdraw(msg.sender, to, shareAmount);
    }

    function _withdraw(address owner, address to, uint256 shareAmount) internal returns (uint256 amount) {
        if (paused) revert Closed();
        if (shareAmount == 0 || shares[owner] < shareAmount) revert Insufficient();
        uint256 price = sharePrice();
        amount = shareAmount * price / SCALE;
        if (amount == 0 || amount > freeCash) revert Insufficient();
        shares[owner] -= shareAmount;
        totalShares -= shareAmount;
        freeCash -= amount;
        uint256 beforeBalance = asset.balanceOf(to);
        asset.safeTransfer(to, amount);
        if (asset.balanceOf(to) - beforeBalance != amount) revert AccountingMismatch();
        emit Withdrawn(owner, amount, shareAmount);
    }

    function requestWithdrawQueued(uint256 shareAmount, address to) external returns (uint256 withdrawalId, uint256 amount) {
        if (paused || to == address(0) || shareAmount == 0 || shares[msg.sender] < shareAmount) revert Insufficient();
        uint256 price = sharePrice();
        amount = shareAmount * price / SCALE;
        if (amount == 0) revert Insufficient();
        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        withdrawalId = ++withdrawalNonce;
        queuedWithdrawalAssets += amount;
        withdrawals[withdrawalId] = Withdrawal(msg.sender, to, shareAmount, amount, false, false);
        emit WithdrawalQueued(withdrawalId, msg.sender, to, shareAmount, amount);
    }

    function claimWithdrawal(uint256 withdrawalId) external returns (uint256 amount) {
        Withdrawal storage withdrawal = withdrawals[withdrawalId];
        if (withdrawal.owner != msg.sender || withdrawal.claimed || withdrawal.cancelled || withdrawal.amount > freeCash) revert Insufficient();
        amount = withdrawal.amount;
        withdrawal.claimed = true;
        queuedWithdrawalAssets -= amount;
        freeCash -= amount;
        uint256 beforeBalance = asset.balanceOf(withdrawal.recipient);
        asset.safeTransfer(withdrawal.recipient, amount);
        if (asset.balanceOf(withdrawal.recipient) - beforeBalance != amount) revert AccountingMismatch();
        emit WithdrawalClaimed(withdrawalId, withdrawal.recipient, amount);
    }

    function cancelWithdrawal(uint256 withdrawalId) external returns (uint256 shareAmount) {
        Withdrawal storage withdrawal = withdrawals[withdrawalId];
        if (withdrawal.owner != msg.sender || withdrawal.claimed || withdrawal.cancelled) revert Unauthorized();
        withdrawal.cancelled = true;
        shareAmount = withdrawal.shares;
        queuedWithdrawalAssets -= withdrawal.amount;
        shares[msg.sender] += shareAmount;
        totalShares += shareAmount;
        emit WithdrawalCancelled(withdrawalId, msg.sender, shareAmount);
    }

    function reserve(bytes32 creditId, uint256 amount) public onlyCore {
        if (creditId == bytes32(0) || amount == 0 || amount > freeCash) revert Insufficient();
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
        if (amount == 0 || principalPaid + interestPaid + feePaid != amount) revert AccountingMismatch();
        if (principalPaid > creditDrawn[creditId] || principalPaid > drawnPrincipal) revert AccountingMismatch();
        uint256 receivablePaid = interestPaid + feePaid;
        if (receivablePaid > creditAccruedReceivable[creditId] || receivablePaid > accruedReceivables) revert AccountingMismatch();
        creditDrawn[creditId] -= principalPaid;
        drawnPrincipal -= principalPaid;
        creditAccruedReceivable[creditId] -= receivablePaid;
        accruedReceivables -= receivablePaid;
        freeCash += amount;
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

    function totalAssets() public view returns (uint256) {
        uint256 gross = freeCash + committedCash + drawnPrincipal + accruedReceivables + pendingSettlement + bondCash;
        uint256 liabilities = bondLiabilities + queuedWithdrawalAssets;
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
        if (!settlementInboxes[inbox] || amount == 0 || amount > pendingByInbox[inbox] || amount > pendingByCredit[creditId]) revert AccountingMismatch();
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
        if (recipient == address(0) || amount == 0 || amount > bondByCredit[creditId] || amount > bondLiabilities) revert AccountingMismatch();
        bondByCredit[creditId] -= amount;
        bondCash -= amount;
        bondLiabilities -= amount;
        uint256 beforeBalance = asset.balanceOf(recipient);
        asset.safeTransfer(recipient, amount);
        if (asset.balanceOf(recipient) - beforeBalance != amount) revert AccountingMismatch();
    }

    function onSettlement(bytes32, bytes32 creditId, address settlementToken, uint256 amount) external {
        if (!settlementInboxes[msg.sender] || settlementToken != asset || amount == 0) revert Unauthorized();
        if (lpInboxRecipient[msg.sender] != address(0)) {
            if (creditId != bytes32(0) || lpInboxMinted[msg.sender]) revert InvalidInbox();
            uint256 price = sharePrice();
            uint256 minted = totalShares == 0 ? amount : amount * SCALE / price;
            if (minted == 0 || minted < lpInboxMinShares[msg.sender]) revert InvalidShares();
            lpInboxMinted[msg.sender] = true;
            freeCash += amount;
            totalShares += minted;
            shares[lpInboxRecipient[msg.sender]] += minted;
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
