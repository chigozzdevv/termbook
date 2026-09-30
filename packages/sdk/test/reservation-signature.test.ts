import { describe, expect, it } from "vitest";
import { Signer } from "../src/wallet/signer.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as const;
const word = (digit: string) => `0x${digit.repeat(64)}` as const;
const signer = new Signer({ address: address("1"), signTypedData: async () => word("a") });
const quote = { domain: word("1"), intentId: word("2"), borrower: address("1"), owner: address("2"),
  house: address("3"), vault: address("4"), sourceChain: 1, collateralVault: address("5"),
  collateralAsset: address("6"), collateralAmount: 100n, returnRecipient: address("2"), settlementAsset: address("7"),
  limit: 200n, maturity: 20000, revolving: false, bundleId: word("3"), setupDeadline: 10000, grace: 100,
  reservationBond: 10n, nonce: 1n, expiry: 9000, termsHash: word("4"), reservationPolicyHash: word("5"),
  bondPayer: address("8"), bondRefundRecipient: address("8") };

describe("reservation authorization", () => {
  it("binds the accepted policy and the payer's refund destination into the House signature", () => {
    const digest = signer.fullQuoteDigest(quote);
    for (const change of [{ reservationPolicyHash: word("6") }, { bondPayer: address("9") },
      { bondRefundRecipient: address("9") }, { reservationBond: 11n }, { setupDeadline: 10001 }]) {
      expect(signer.fullQuoteDigest({ ...quote, ...change })).not.toBe(digest);
    }
  });
});
