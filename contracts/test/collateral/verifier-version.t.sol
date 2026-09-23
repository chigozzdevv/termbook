// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../MockERC20.sol";
import {TermbookCore} from "../../src/credit/TermbookCore.sol";
import {HouseVault} from "../../src/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/collateral/VerifierRegistry.sol";
import {Types} from "../../src/shared/Types.sol";

contract MockVersionedVerifier {
    uint256 public immutable version;

    constructor(uint256 version_) {
        version = version_;
    }

    function admission() external view returns (uint256, uint256, bytes32) {
        return (99, version, keccak256("bootstrap"));
    }

    function lightClient() external view returns (address) {
        return address(this);
    }

    function proofMaxAge() external pure returns (uint256) {
        return 1 days;
    }

    function chainId() external pure returns (uint256) {
        return 99;
    }

    function consensusVersion() external view returns (uint256) {
        return version;
    }

    function bootstrapHash() external pure returns (bytes32) {
        return keccak256("bootstrap");
    }
}

contract VerifierVersionTest is Test {
    MockERC20 token;
    TermbookCore core;
    HouseVault vault;
    VerifierRegistry registry;
    uint256 houseKey = 0xBEEF;
    uint256 borrowerKey = 0xCAFE;
    address house;
    address borrower;
    address verifier;

    function setUp() public {
        token = new MockERC20();
        core = new TermbookCore(address(this), address(this), address(0));
        vault = new HouseVault(address(token), address(core), address(this), address(0), address(0));
        registry = new VerifierRegistry(address(this));
        core.setVerifierRegistry(address(registry));
        verifier = address(new MockVersionedVerifier(1));
        registry.setVerifier(99, verifier, 1, 1 days);
        core.setSourceCollateralVault(99, address(token), address(0x1234));
        house = vm.addr(houseKey);
        borrower = vm.addr(borrowerKey);
        token.mint(address(this), 100);
        token.approve(address(vault), 100);
        vault.deposit(address(this), 100);
    }

    function testRemoteCreditPinsVerifierVersion() public {
        bytes32 creditId = keccak256("credit");
        bytes32 intentId = keccak256("intent");
        uint256 setupDeadline = block.timestamp + 1 days;
        uint256 maturity = block.timestamp + 30 days;
        uint256 expiry = block.timestamp + 1 days;
        bytes32 bundleId = keccak256("bundle");
        bytes32 termsHash = keccak256("terms");
        bytes32 digest = core.quoteDigest(
            intentId,
            borrower,
            house,
            address(vault),
            100,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            0,
            1,
            expiry,
            termsHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, digest);
        vm.prank(borrower);
        core.accept(
            creditId,
            intentId,
            borrower,
            house,
            address(vault),
            100,
            maturity,
            false,
            bundleId,
            setupDeadline,
            0,
            termsHash,
            1,
            expiry,
            abi.encodePacked(r, s, v)
        );
        vm.prank(borrower);
        core.setRemoteCollateral(creditId, 99, address(0x1234), address(token), 100, borrower, borrower);
        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, keccak256("lock"));
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        assertEq(credit.verifierVersion, 1);

        registry.setVerifier(99, address(new MockVersionedVerifier(1)), 1, 1 days);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(creditId, 99, hex"", hex"");

        registry.setVerifier(99, address(new MockVersionedVerifier(2)), 2, 1 days);
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(creditId, 99, hex"", hex"");
    }

    function testFullRemoteQuoteCanBindLockBeforeProof() public {
        Types.Quote memory quote;
        quote.borrower = borrower;
        quote.owner = borrower;
        quote.intentId = keccak256("quoted-intent");
        quote.house = house;
        quote.vault = address(vault);
        quote.sourceChain = 99;
        quote.collateralVault = address(0x1234);
        quote.collateralAsset = address(token);
        quote.collateralAmount = 100;
        quote.returnRecipient = borrower;
        quote.settlementAsset = address(token);
        quote.limit = 100;
        quote.bundleId = keccak256("bundle");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = block.timestamp + 1 days;
        quote.termsHash = keccak256("terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(houseKey, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);

        vm.prank(borrower);
        core.acceptQuote(quote);
        bytes32 creditId = keccak256(abi.encode(quote.intentId, borrower, house, quote.nonce));
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.CollateralLocking));

        vm.prank(borrower);
        core.bindRemoteCollateral(creditId, keccak256("quoted-lock"));
        assertEq(uint256(core.creditFacility(creditId)), uint256(Types.Facility.CollateralProving));
    }
}
