// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "../CoreFixture.sol";
import {MockRemoteSaleOracle} from "../MockRemoteSaleOracle.sol";
import {MockERC20} from "../MockERC20.sol";
import {MockEvmWormhole} from "./wormhole-evm-route.t.sol";
import {TermbookCore} from "../../src/monad/credit/TermbookCore.sol";
import {HouseVault} from "../../src/monad/house/HouseVault.sol";
import {VerifierRegistry} from "../../src/monad/collateral/VerifierRegistry.sol";
import {WormholeEvmMessageClient} from "../../src/shared/collateral/WormholeEvmMessageClient.sol";
import {WormholeEthereumVerifier} from "../../src/monad/collateral/WormholeEthereumVerifier.sol";
import {WormholeEthereumPublisher} from "../../src/ethereum/collateral/WormholeEthereumPublisher.sol";
import {WormholeMonadVerifier} from "../../src/ethereum/collateral/WormholeMonadVerifier.sol";
import {RemoteCollateralController} from "../../src/ethereum/collateral/RemoteCollateralController.sol";
import {SourceRecoveryVault} from "../../src/ethereum/collateral/SourceRecoveryVault.sol";
import {CollateralVault} from "../../src/shared/collateral/CollateralVault.sol";
import {LightClientVerifier} from "../../src/shared/collateral/LightClientVerifier.sol";
import {RemoteAction} from "../../src/shared/collateral/RemoteAction.sol";
import {WormholeTermbookMessages as Messages} from "../../src/shared/collateral/WormholeTermbookMessages.sol";
import {Types} from "../../src/shared/Types.sol";

contract BaseWormholeTest is CoreFixture {
    uint256 constant BASE = 84532;
    uint256 constant MONAD = 10143;
    uint256 constant HOUSE_KEY = 0xBEEF;
    uint256 constant BORROWER_KEY = 0xCAFE;
    bytes32 constant LOCK = keccak256("base-lock");
    address constant FACTORY = address(0xFACA);
    TermbookCore core;
    HouseVault house;
    MockERC20 weth;
    MockEvmWormhole sourceWormhole;
    MockEvmWormhole monadWormhole;
    RemoteCollateralController controller;
    SourceRecoveryVault recovery;
    CollateralVault vault;
    WormholeEthereumPublisher publisher;
    WormholeEthereumVerifier verifier;
    bytes32 creditId;
    Types.Quote quote;

    function setUp() public {
        vm.chainId(MONAD);
        vm.warp(2 days);
        core = _deployCore(address(this), address(this), address(0));
        MockERC20 usdc = new MockERC20();
        house = HouseVault(deployCode("HouseVault.sol:HouseVault", abi.encode(address(usdc), address(core), address(this), address(0), address(0))));
        usdc.mint(address(this), 1000 ether);
        usdc.approve(address(house), 1000 ether);
        house.deposit(address(this), 1000 ether);
        monadWormhole = new MockEvmWormhole(10009);
        core.configureEthereumWormhole(address(monadWormhole));

        vm.chainId(BASE);
        weth = new MockERC20();
        sourceWormhole = new MockEvmWormhole(10004);
        WormholeEvmMessageClient auth = new WormholeEvmMessageClient(address(sourceWormhole), 10004, 10009, MONAD, 1, bytes32(uint256(uint160(address(core)))), 7200);
        WormholeEvmMessageClient rec = new WormholeEvmMessageClient(address(sourceWormhole), 10004, 10009, MONAD, 1, bytes32(uint256(uint160(FACTORY))), 7200);
        WormholeMonadVerifier reverse = new WormholeMonadVerifier(address(auth), address(rec), address(core), FACTORY);
        recovery = new SourceRecoveryVault(address(weth), MONAD, FACTORY, address(reverse), address(this), address(1), address(2));
        controller = new RemoteCollateralController(address(weth), MONAD, address(core), address(recovery), address(reverse), address(this), address(this));
        vault = controller.vault();
        recovery.setController(address(controller));
        controller.setPaused(false);
        publisher = new WormholeEthereumPublisher(address(vault), address(controller), address(sourceWormhole));

        vm.chainId(MONAD);
        WormholeEvmMessageClient client = new WormholeEvmMessageClient(address(monadWormhole), 10009, 10004, BASE, 1, bytes32(uint256(uint160(address(publisher)))), 7200);
        verifier = new WormholeEthereumVerifier(address(client), address(publisher), address(publisher).codehash, address(vault), address(vault).codehash, address(controller), address(controller).codehash);
        VerifierRegistry registry = new VerifierRegistry(address(this));
        core.setVerifierRegistry(address(registry));
        registry.setVerifier(BASE, address(verifier), 1, 7200);
        core.setSourceCollateralVault(BASE, address(weth), address(vault));
        core.setSourceRecoveryVault(BASE, address(weth), address(recovery));
        core.setRemoteSalePolicy(BASE, address(weth), house.asset(), address(new MockRemoteSaleOracle()), keccak256("ETH/USDC"), 18, 9500, 100 ether);
        quote.borrower = vm.addr(BORROWER_KEY);
        quote.owner = quote.borrower;
        quote.intentId = keccak256("base-intent");
        quote.house = vm.addr(HOUSE_KEY);
        quote.vault = address(house);
        quote.sourceChain = BASE;
        quote.collateralVault = address(vault);
        quote.collateralAsset = address(weth);
        quote.collateralAmount = 1 ether;
        quote.returnRecipient = quote.borrower;
        quote.settlementAsset = house.asset();
        quote.limit = 1 ether;
        quote.bundleId = keccak256("base-spot");
        quote.setupDeadline = block.timestamp + 1 days;
        quote.maturity = block.timestamp + 30 days;
        quote.nonce = 1;
        quote.expiry = quote.setupDeadline;
        quote.termsHash = keccak256("base-terms");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HOUSE_KEY, core.quoteDigestFull(quote));
        quote.signature = abi.encodePacked(r, s, v);
        vm.prank(quote.borrower);
        core.acceptQuote(quote);
        creditId = keccak256(abi.encode(quote.intentId, quote.borrower, quote.house, quote.nonce));
        vm.prank(quote.borrower);
        core.bindRemoteCollateral(creditId, LOCK);
        vm.chainId(BASE);
        weth.mint(quote.owner, quote.collateralAmount);
        vm.startPrank(quote.owner);
        weth.approve(address(vault), quote.collateralAmount);
        vault.lockRemoteWithDeadline(LOCK, creditId, quote.borrower, quote.owner, quote.collateralAmount, quote.returnRecipient, quote.setupDeadline, 1);
        vm.stopPrank();
        publisher.publishLock(LOCK);
    }

    function vaa(uint16 chain, address emitter, bytes memory payload) private view returns (bytes memory) {
        return abi.encode(chain, bytes32(uint256(uint160(emitter))), uint8(0), uint32(block.timestamp), payload, true);
    }

    function prove() private {
        vm.chainId(MONAD);
        core.proveCollateral(creditId, BASE, vaa(10004, address(publisher), sourceWormhole.lastPayload()), "");
    }

    function testBaseLockProofAndGovernedReturnUseBothDirections() public {
        prove();
        assertTrue(core.collateralProven(creditId));
        assertEq(weth.balanceOf(address(vault)), 1 ether);
        vm.warp(quote.setupDeadline + 1);
        core.expireSetup(creditId);
        vm.prank(quote.borrower);
        core.authorizeReturn(creditId, LOCK, 1 ether);
        bytes32 actionHash = core.remoteReturnActionHash(creditId);
        bytes memory authorization = vaa(10009, address(core), monadWormhole.lastPayload());
        RemoteAction.Authorization memory action = RemoteAction.Authorization(MONAD, address(core), BASE, address(vault), creditId, LOCK, address(weth), 0, quote.returnRecipient, 1 ether, core.remoteActionNonce(creditId), core.remoteReturnDeadline(creditId));
        vm.chainId(BASE);
        controller.execute(action, authorization, "");
        assertEq(weth.balanceOf(quote.returnRecipient), 1 ether);
        vm.expectRevert(RemoteCollateralController.Invalid.selector);
        controller.execute(action, authorization, "");
        publisher.publishApplied(actionHash);
        vm.chainId(MONAD);
        core.confirmRemoteReturn(creditId, vaa(10004, address(publisher), sourceWormhole.lastPayload()), "");
        assertEq(core.pendingRemoteReturn(creditId), 0);
        assertEq(core.creditDetails(creditId).collateralAmount, 0);
    }

    function testEthereumAndWrongEmitterProofsCannotRecognizeBaseCollateral() public {
        vm.chainId(MONAD);
        bytes memory payload = sourceWormhole.lastPayload();
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(creditId, BASE, vaa(10002, address(publisher), payload), "");
        vm.expectRevert(TermbookCore.InvalidCollateral.selector);
        core.proveCollateral(creditId, BASE, vaa(10004, address(0xBAD), payload), "");
        assertFalse(core.collateralProven(creditId));
    }

    function testBaseSeizureDepositsIntoRecoveryCustody() public {
        bytes32 hash;
        RemoteAction.Authorization memory action = RemoteAction.Authorization(MONAD, address(core), BASE, address(vault), creditId, LOCK, address(weth), 1, address(recovery), 0.5 ether, 1, block.timestamp + 1 hours);
        hash = RemoteAction.hash(action);
        bytes memory auth = vaa(10009, address(core), abi.encode(Messages.AUTH, keccak256(abi.encode(creditId, hash, uint8(1)))));
        controller.execute(action, auth, "");
        assertEq(weth.balanceOf(address(recovery)), 0.5 ether);
        assertEq(recovery.held(creditId), 0.5 ether);
        publisher.publishApplied(hash);
        vm.chainId(MONAD);
        assertTrue(verifier.verifyAppliedAction(vaa(10004, address(publisher), sourceWormhole.lastPayload()), "", address(vault), hash));
    }

    function testBaseRejectsSepoliaCustomConfirmationPolicy() public {
        vm.expectRevert(WormholeEthereumPublisher.Invalid.selector);
        publisher.configureTestnetConfirmations(5);
    }

    function testBaseMainnetCannotBeAdmittedToMonadTestnet() public {
        vm.chainId(MONAD);
        WormholeEvmMessageClient wrong = new WormholeEvmMessageClient(address(monadWormhole), 10009, 30, 8453, 1, bytes32(uint256(uint160(address(publisher)))), 7200);
        vm.expectRevert(LightClientVerifier.InvalidLightClient.selector);
        new WormholeEthereumVerifier(address(wrong), address(publisher), address(publisher).codehash, address(vault), address(vault).codehash, address(controller), address(controller).codehash);
    }
}
