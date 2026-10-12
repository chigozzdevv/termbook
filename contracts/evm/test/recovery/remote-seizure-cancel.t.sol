// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockHealthSource} from "../MockHealthSource.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {CreditAccount} from "../../src/monad/credit/CreditAccount.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {RiskEngine} from "../../src/monad/risk/RiskEngine.sol";
import {VerifierRegistry} from "../../src/monad/collateral/VerifierRegistry.sol";
import {Types} from "../../src/shared/Types.sol";
import {InboxFactory} from "../../src/monad/routing/InboxFactory.sol";
import {IExitVerifier} from "../../src/monad/integration/IExitVerifier.sol";
import {WormholeTermbookMessages as WormholeMessages} from "../../src/shared/collateral/WormholeTermbookMessages.sol";

contract MockEthereumAuthorizationWormhole {
    bytes public lastPayload;

    function chainId() external pure returns (uint16) {
        return 48;
    }

    function messageFee() external pure returns (uint256) {
        return 1 wei;
    }

    function publishMessage(uint32, bytes memory payload, uint8 consistency) external payable returns (uint64) {
        require(msg.value == 1 wei && consistency == 0, "invalid-publish");
        lastPayload = payload;
        return 7;
    }
}

contract MockUnconsumedVerifier {
    address public immutable sourceVault;
    address public immutable sourceController;
    bool public unconsumed;
    bytes32 public clearanceHash;
    function setClearance(bytes32 hash) external { clearanceHash = hash; }
    function verifyAppliedAction(bytes calldata, bytes calldata, address, bytes32) external pure returns (bool) { return true; }
    function verifyRecoveryClearance(bytes calldata, bytes calldata, bytes32, address, bytes32 hash)
        external view returns (bool) { return hash == clearanceHash && hash != bytes32(0); }

    constructor(address vault, address controller) {
        sourceVault = vault;
        sourceController = controller;
    }

    function admission() external pure returns (uint256, uint256, bytes32) {
        return (1, 1, keccak256("ethereum-bootstrap"));
    }

    function lightClient() external view returns (address) {
        return address(this);
    }

    function proofMaxAge() external pure returns (uint256) {
        return 1 days;
    }

    function chainId() external pure returns (uint256) {
        return 1;
    }

    function consensusVersion() external pure returns (uint256) {
        return 1;
    }

    function bootstrapHash() external pure returns (bytes32) {
        return keccak256("ethereum-bootstrap");
    }

    function verifyLock(bytes calldata, bytes calldata, address vault, bytes32 digest) external view returns (bool) {
        return vault == sourceVault && digest != bytes32(0);
    }

    function setUnconsumed(bool value) external {
        unconsumed = value;
    }

    function verifyUnconsumedAction(
        bytes calldata,
        bytes calldata,
        address controller,
        bytes32 actionHash,
        uint256 deadline
    ) external view returns (bool) {
        return unconsumed && controller == sourceController && actionHash != bytes32(0) && deadline < block.timestamp;
    }
}

contract RemoteRecoveryExitVerifier is IExitVerifier {
    function canExit(bytes32, address) external pure returns (bool) { return true; }
}

contract RemoteSeizureCancelTest is CoreFixture {
    MockERC20 private settlement;
    MockHealthSource private healthSource;
    TermbookCore private core;
    HouseVault private vault;
    MockUnconsumedVerifier private verifier;
    uint256 private houseKey = 0xBEEF;
    uint256 private borrowerKey = 0xCAFE;
    address private sourceAsset = address(0x1234);
    address private sourceVault = address(0x4567);
    address private sourceRecoveryVault = address(0x789A);
    address private sourceController = address(0xABCD);

    function setUp() public {
        vm.chainId(143);
        settlement = new MockERC20();
        healthSource = new MockHealthSource();
        core = _deployCore(address(this), address(this), address(0));
        InboxFactory factory = InboxFactory(deployCode("InboxFactory.sol:InboxFactory", abi.encode(address(this))));
        vault = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(settlement), address(core), address(this), address(factory), address(0))));
        core.setExitVerifier(keccak256("bundle"), address(new RemoteRecoveryExitVerifier()));
        verifier = new MockUnconsumedVerifier(sourceVault, sourceController);
        VerifierRegistry registry = new VerifierRegistry(address(this));
        core.setVerifierRegistry(address(registry));
        registry.setVerifier(1, address(verifier), 1, 1 days);
        core.setSourceCollateralVault(1, sourceAsset, sourceVault);
        core.setSourceRecoveryVault(1, sourceAsset, sourceRecoveryVault);
        core.setRemoteSalePolicy(
            1,
            sourceAsset,
            address(settlement),
            address(new MockRemoteSaleOracle()),
            keccak256("ETH/settlement"),
            18,
            9_000,
            1_000e18
        );
        core.setRisk(address(new RiskEngine(address(core))));
        core.setHealthSource(address(healthSource));
        core.setRecoveryKeeper(address(this), true);
        settlement.mint(address(this), 1_000e18);
        settlement.approve(address(vault), 1_000e18);
        vault.deposit(address(this), 1_000e18);
    }

    function _credit() private returns (bytes32 creditId) {
        address borrower = vm.addr(borrowerKey);
        address house = vm.addr(houseKey);
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("remote-cancel-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = 1;
        quote.collateralVault = sourceVault;
        quote.collateralAsset = sourceAsset;
        quote.collateralAmount = 100e18;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(settlement);
        quote.limit = 100e18;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = quote.setupDeadline;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(borrower);
        core.acceptQuote(quote);
        creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, keccak256("remote-lock"));
        core.proveCollateral(creditId, 1, hex"01", hex"02");
        CreditAccount account = new CreditAccount(creditId, borrower, address(core));
        vm.prank(borrower);
        core.bindAccount(creditId, address(account));
        core.configureRisk(creditId, 15_000, 13_000, 12_000, 11_500, 11_000);
        healthSource.setSnapshot(creditId, Types.HealthSnapshot(0, 0, 100e18, 0, 10_000, 0, 0, 100e18, 0));
        core.recordHealth(creditId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encode(
                core.domain(),
                creditId,
                uint256(50e18),
                uint256(50e18),
                uint256(1),
                deadline,
                core.creditRevision(creditId)
            )
        );
        (v, r, s) = vm.sign(borrowerKey, digest);
        core.draw(creditId, 50e18, 50e18, 1, deadline, abi.encodePacked(r, s, v));
        healthSource.setSnapshot(creditId, Types.HealthSnapshot(50e18, 0, 0, 0, 10_000, 0, 0, 0, 0));
        core.recordHealth(creditId);
        core.startLiquidation(creditId);
    }

    function testExpiredSeizureRequiresFinalizedNonexecutionProof() public {
        bytes32 creditId = _credit();
        uint256 deadline = block.timestamp + 1 hours;
        core.authorizeRemoteSeizure(creditId, 10e18, deadline);
        bytes32 actionHash = core.remoteSeizureActionHash(creditId);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredRemoteSeizure(creditId, hex"01", hex"02");
        vm.warp(deadline + 1);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.cancelExpiredRemoteSeizure(creditId, hex"01", hex"02");
        verifier.setUnconsumed(true);
        core.cancelExpiredRemoteSeizure(creditId, hex"01", hex"02");
        assertEq(core.pendingRemoteSeizure(creditId), 0);
        assertEq(core.remoteSeizureActionHash(creditId), bytes32(0));
        assertEq(core.remoteSeizureDeadline(creditId), 0);
        assertEq(core.creditDetails(creditId).collateralAmount, 100e18);
        vm.expectRevert(TermbookCore.Pending.selector);
        core.cancelExpiredRemoteSeizure(creditId, hex"01", hex"02");
        core.authorizeRemoteSeizure(creditId, 10e18, block.timestamp + 1 hours);
        assertTrue(core.remoteSeizureActionHash(creditId) != actionHash);
    }

    function testRemoteRecoveryFinalizesOnlyAfterVerifiedSourceClearance() public {
        bytes32 id = _credit();
        core.authorizeRemoteSeizure(id, 100e18, block.timestamp + 1 hours);
        bytes32 hash = core.remoteSeizureActionHash(id);
        core.confirmRemoteSeizure(id, hex"01", hex"02");
        address borrower = vm.addr(borrowerKey);
        settlement.mint(borrower, 50e18);
        vm.startPrank(borrower);
        settlement.approve(address(core), 50e18);
        core.repay(id, 50e18);
        vm.stopPrank();
        vm.expectRevert(TermbookCore.RecoveryIncomplete.selector);
        vault.finalizeRecovery(id);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.confirmRemoteRecoveryClearance(id, hex"01", hex"02");
        verifier.setClearance(hash);
        core.confirmRemoteRecoveryClearance(id, hex"01", hex"02");
        vault.finalizeRecovery(id);
        assertEq(uint256(core.creditFacility(id)), uint256(Types.Facility.Liquidated));
    }

    function testEthereumSeizurePublishesAndRepublishesExactAuthorization() public {
        bytes32 creditId = _credit();
        MockEthereumAuthorizationWormhole wormhole = new MockEthereumAuthorizationWormhole();
        core.configureEthereumWormhole(address(wormhole));
        vm.deal(address(this), 2 wei);
        uint256 deadline = block.timestamp + 1 hours;
        core.authorizeRemoteSeizure{value: 1 wei}(creditId, 10e18, deadline);
        bytes32 actionHash = core.remoteSeizureActionHash(creditId);
        bytes32 eventDigest = keccak256(abi.encode(creditId, actionHash, uint8(1)));
        assertEq(wormhole.lastPayload(), abi.encode(WormholeMessages.AUTH, eventDigest));
        assertTrue(core.ethereumAuthorizationPublished(actionHash));
        assertEq(core.ethereumAuthorizationSequenceOf(actionHash), 7);
        core.republishEthereumAuthorization{value: 1 wei}(creditId, 1);
        assertEq(wormhole.lastPayload(), abi.encode(WormholeMessages.AUTH, eventDigest));
        vm.warp(deadline + 1);
        vm.expectRevert(TermbookCore.InvalidAuthority.selector);
        core.republishEthereumAuthorization(creditId, 1);
    }
}
