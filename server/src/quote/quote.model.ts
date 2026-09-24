import mongoose from "mongoose";

const quoteSchema = new mongoose.Schema(
  {
    quoteId: { type: String, required: true, unique: true },
    kind: String,
    solana: mongoose.Schema.Types.Mixed,
    intentId: String,
    borrower: String,
    house: String,
    vault: String,
    owner: String,
    sourceChain: Number,
    collateralVault: String,
    collateralAsset: String,
    collateralAmount: String,
    returnRecipient: String,
    settlementAsset: String,
    limit: String,
    aprBps: Number,
    originationFee: String,
    commitmentFeeBps: Number,
    maturity: Number,
    setupDeadline: Number,
    grace: Number,
    reservationBond: String,
    nonce: String,
    expiry: Number,
    bundleId: String,
    termsHash: String,
    revolving: Boolean,
    signature: String,
    domain: String,
  },
  { timestamps: true },
);

quoteSchema.index({ intentId: 1, expiry: 1, createdAt: -1 });

export const QuoteModel = mongoose.models["Quote"] ?? mongoose.model("Quote", quoteSchema);
