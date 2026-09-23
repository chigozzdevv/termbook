// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Types {
    enum Facility { Reserved, CollateralLocking, CollateralProving, AccountCreating, Ready, Closing, Closed, Aborted, Liquidating, RecoveryPending, Liquidated }
    enum Payment { Undrawn, Current, Matured, Defaulted, Repaid }
    enum Risk { Healthy, Watch, Frozen, Liquidatable }

    struct Quote {
        address borrower;
        address owner;
        bytes32 intentId;
        address house;
        address vault;
        uint256 sourceChain;
        address collateralVault;
        address collateralAsset;
        uint256 collateralAmount;
        address returnRecipient;
        address settlementAsset;
        uint256 limit;
        bytes32 bundleId;
        uint256 setupDeadline;
        uint256 maturity;
        uint256 gracePeriod;
        uint256 reservationBond;
        uint256 nonce;
        uint256 expiry;
        bytes32 termsHash;
        bool revolving;
        uint256 aprBps;
        uint256 originationFee;
        uint256 commitmentFeeBps;
        bytes signature;
    }

    struct SolanaQuote {
        Quote quote;
        bytes32 sourceGenesis;
        bytes32 sourceVault;
        bytes32 sourceAsset;
        bytes32 sourceOwner;
        bytes32 returnRecipient;
        bytes32 recoveryVault;
        uint64 verifierVersion;
    }

    struct SessionAuth {
        bytes32 creditId;
        address sessionKey;
        bytes32 capability;
        uint256 maxDraw;
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    struct HealthSnapshot {
        uint256 debt;
        uint256 cash;
        uint256 sourceValue;
        int256 appValue;
        uint256 retainedSource;
        uint256 retainedApp;
        uint256 recoveryCosts;
        uint256 recoveryValue;
        uint256 healthBps;
    }

    struct Operation {
        bytes32 operationId;
        uint8 kind;
        address payer;
        address vault;
        bytes32 creditId;
        address token;
        uint256 maxIn;
        uint256 minOut;
        uint256 deadline;
        address refundRecipient;
    }
}
