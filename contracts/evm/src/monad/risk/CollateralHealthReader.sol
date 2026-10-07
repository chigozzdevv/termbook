// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProxyInitializable} from "../../shared/ProxyInitializable.sol";

import {IHealthReader, ICashReader, HealthReading} from "./IHealthSource.sol";
import {TermbookCore} from "../credit/TermbookCore.sol";

interface ICollateralPriceOracle {
    function read(bytes32 id) external view returns (uint256 value, uint256 updatedAt, uint80 roundId);
}

interface ICollateralBalanceToken {
    function balanceOf(address owner) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface ICollateralHouseVault {
    function asset() external view returns (address);
}

contract CollateralHealthReader is IHealthReader, ICashReader, ProxyInitializable {
    struct Market {
        bytes32 priceId;
        bytes32 settlementCodeHash;
        bytes32 collateralCodeHash;
        uint16 retainedSourceBps;
        uint8 collateralDecimals;
        uint8 settlementDecimals;
        uint128 recoveryCosts;
        bool active;
    }

    TermbookCore public core;
    address public governance;
    address public oracleRegistry;
    mapping(bytes32 => Market) public markets;

    error Unauthorized();
    error InvalidMarket();
    error InvalidCredit();

    event MarketSet(bytes32 indexed marketId, uint256 indexed sourceChain, address indexed asset);
    event MarketDisabled(bytes32 indexed marketId);

    constructor(address core_, address governance_, address oracleRegistry_) {
        if (!(
            core_ == address(0)
            && governance_ == address(0)
            && oracleRegistry_ == address(0)
        )) {
            _initializeCollateralHealthReader(core_, governance_, oracleRegistry_);
        }
    }

    function initialize(address core_, address governance_, address oracleRegistry_) external initializer {
        _initializeCollateralHealthReader(core_, governance_, oracleRegistry_);
    }

    function upgradeContractId() external pure override returns (bytes32) {
        return keccak256("termbook.CollateralHealthReader.v1");
    }

    function _initializeCollateralHealthReader(address core_, address governance_, address oracleRegistry_) private {
        if (core_.code.length == 0 || governance_ == address(0) || oracleRegistry_.code.length == 0) {
            revert InvalidMarket();
        }
        core = TermbookCore(core_);
        governance = governance_;
        oracleRegistry = oracleRegistry_;
    }

    function marketId(uint256 sourceChain, address collateralAsset, address settlementAsset)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(sourceChain, collateralAsset, settlementAsset));
    }

    function setMarket(
        uint256 sourceChain,
        address collateralAsset,
        address settlementAsset,
        bytes32 priceId,
        uint8 collateralDecimals,
        uint16 retainedSourceBps,
        uint128 recoveryCosts
    ) external {
        if (msg.sender != governance) revert Unauthorized();
        bytes32 id = marketId(sourceChain, collateralAsset, settlementAsset);
        if (
            sourceChain == 0 || collateralAsset == address(0) || settlementAsset.code.length == 0
                || priceId == bytes32(0) || collateralDecimals > 18 || retainedSourceBps > 10_000
                || markets[id].priceId != bytes32(0)
        ) revert InvalidMarket();
        uint8 settlementDecimals = ICollateralBalanceToken(settlementAsset).decimals();
        if (settlementDecimals > 18) revert InvalidMarket();
        bytes32 collateralCodeHash;
        if (sourceChain == block.chainid) {
            if (collateralAsset.code.length == 0) revert InvalidMarket();
            if (ICollateralBalanceToken(collateralAsset).decimals() != collateralDecimals) revert InvalidMarket();
            collateralCodeHash = collateralAsset.codehash;
            if (collateralAsset != settlementAsset) {
                (address saleOracle, bytes32 salePriceId,,,,,,,, bool active) =
                    core.localSalePolicies(core.localSaleMarketId(collateralAsset, settlementAsset));
                if (!active || saleOracle != oracleRegistry || salePriceId != priceId) revert InvalidMarket();
            }
        }
        (uint256 price,,) = ICollateralPriceOracle(oracleRegistry).read(priceId);
        if (price == 0 || price > type(uint128).max) revert InvalidMarket();
        markets[id] = Market({
            priceId: priceId,
            settlementCodeHash: settlementAsset.codehash,
            collateralCodeHash: collateralCodeHash,
            retainedSourceBps: retainedSourceBps,
            collateralDecimals: collateralDecimals,
            settlementDecimals: settlementDecimals,
            recoveryCosts: recoveryCosts,
            active: true
        });
        emit MarketSet(id, sourceChain, collateralAsset);
    }

    function disableMarket(uint256 sourceChain, address collateralAsset, address settlementAsset) external {
        if (msg.sender != governance) revert Unauthorized();
        bytes32 id = marketId(sourceChain, collateralAsset, settlementAsset);
        if (!markets[id].active) revert InvalidMarket();
        markets[id].active = false;
        emit MarketDisabled(id);
    }

    function readHealth(bytes32 creditId, uint256 revision, uint256 debt, address oracleRegistry_)
        external
        view
        returns (HealthReading memory reading)
    {
        if (
            oracleRegistry_ != oracleRegistry || core.creditRevision(creditId) != revision
                || core.creditDebt(creditId) != debt || !core.collateralProven(creditId)
        ) revert InvalidCredit();
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        if (
            !credit.collateralBound || credit.account == address(0) || credit.vault == address(0)
                || credit.collateralAsset == address(0)
        ) revert InvalidCredit();
        address settlementAsset = ICollateralHouseVault(credit.vault).asset();
        uint256 sourceChain = core.collateralSourceChainOf(creditId);
        Market memory market = markets[marketId(sourceChain, credit.collateralAsset, settlementAsset)];
        if (
            !market.active || settlementAsset.codehash != market.settlementCodeHash
                || ICollateralBalanceToken(settlementAsset).decimals() != market.settlementDecimals
        ) {
            revert InvalidMarket();
        }
        if (sourceChain == block.chainid) {
            if (
                credit.collateralAsset.codehash != market.collateralCodeHash
                    || ICollateralBalanceToken(credit.collateralAsset).decimals() != market.collateralDecimals
            ) {
                revert InvalidMarket();
            }
            if (credit.collateralAsset != settlementAsset) {
                (address saleOracle, bytes32 salePriceId,,,,,,,, bool active) =
                    core.localSalePolicies(core.localSaleMarketId(credit.collateralAsset, settlementAsset));
                if (!active || saleOracle != oracleRegistry || salePriceId != market.priceId) revert InvalidMarket();
            }
        }
        (uint256 price, uint256 updatedAt,) = ICollateralPriceOracle(oracleRegistry).read(market.priceId);
        if (price == 0 || price > type(uint128).max) revert InvalidMarket();
        uint256 sourceValue18 = credit.collateralAmount * price / (10 ** market.collateralDecimals);
        uint256 sourceValue = sourceValue18 * (10 ** market.settlementDecimals) / 1e18;
        reading = HealthReading({
            debt: debt,
            cash: ICollateralBalanceToken(settlementAsset).balanceOf(credit.account),
            sourceValue: sourceValue,
            appValue: 0,
            retainedSource: market.retainedSourceBps,
            retainedApp: 0,
            recoveryCosts: market.recoveryCosts,
            observedAt: updatedAt
        });
    }

    function readCash(bytes32 creditId, uint256 revision) external view returns (uint256 cash, uint256 observedAt) {
        TermbookCore.Credit memory credit = core.creditDetails(creditId);
        if (credit.revision != revision || revision == 0 || credit.account == address(0) || credit.vault == address(0)) {
            revert InvalidCredit();
        }
        cash = ICollateralBalanceToken(ICollateralHouseVault(credit.vault).asset()).balanceOf(credit.account);
        observedAt = block.timestamp;
    }
}
