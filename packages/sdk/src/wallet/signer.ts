import { keccak256, encodeAbiParameters } from "viem";
import type { Wallet } from "../types/client.types.js";

export class Signer {
  wallet: Wallet;

  constructor(wallet: Wallet) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet.address)) throw new Error("bad-address");
    this.wallet = wallet;
  }

  address(): `0x${string}` {
    return this.wallet.address;
  }

  sign(payload: unknown): Promise<`0x${string}`> {
    return this.wallet.signTypedData(payload);
  }

  quoteDigest(
    domain: `0x${string}`,
    intentId: `0x${string}`,
    borrower: `0x${string}`,
    house: `0x${string}`,
    vault: `0x${string}`,
    limit: bigint,
    maturity: number,
    revolving: boolean,
    bundleId: `0x${string}`,
    setupDeadline: number,
    grace: number,
    reservationBond: bigint,
    nonce: bigint,
    expiry: number,
    terms: `0x${string}`,
  ): `0x${string}` {
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "address" },
          { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32" }, { type: "uint256" },
          { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
        ],
        [domain, intentId, borrower, house, vault, limit, BigInt(maturity), revolving, bundleId, BigInt(setupDeadline), BigInt(grace), reservationBond, nonce, BigInt(expiry), terms],
      ),
    );
  }

  quoteDigestWithTerms(
    domain: `0x${string}`,
    intentId: `0x${string}`,
    borrower: `0x${string}`,
    house: `0x${string}`,
    vault: `0x${string}`,
    limit: bigint,
    maturity: number,
    revolving: boolean,
    bundleId: `0x${string}`,
    setupDeadline: number,
    grace: number,
    reservationBond: bigint,
    nonce: bigint,
    expiry: number,
    terms: `0x${string}`,
    aprBps: bigint,
    originationFee: bigint,
    commitmentFeeBps: bigint,
  ): `0x${string}` {
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "address" },
          { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32" },
          { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
          { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" },
          { type: "uint256" },
        ],
        [
          domain, intentId, borrower, house, vault, limit, BigInt(maturity), revolving, bundleId,
          BigInt(setupDeadline), BigInt(grace), reservationBond, nonce, BigInt(expiry), terms,
          aprBps, originationFee, commitmentFeeBps,
        ],
      ),
    );
  }

  fullQuoteDigest(args: {
    domain: `0x${string}`;
    intentId: `0x${string}`;
    borrower: `0x${string}`;
    owner: `0x${string}`;
    house: `0x${string}`;
    vault: `0x${string}`;
    sourceChain: number;
    collateralVault: `0x${string}`;
    collateralAsset: `0x${string}`;
    collateralAmount: bigint;
    returnRecipient: `0x${string}`;
    settlementAsset: `0x${string}`;
    limit: bigint;
    maturity: number;
    revolving: boolean;
    bundleId: `0x${string}`;
    setupDeadline: number;
    grace: number;
    reservationBond: bigint;
    nonce: bigint;
    expiry: number;
    termsHash: `0x${string}`;
    aprBps?: bigint;
    originationFee?: bigint;
    commitmentFeeBps?: bigint;
  }): `0x${string}` {
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
          { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" },
          { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address" },
          { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32" },
          { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
          { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        ],
        [
          args.domain, args.intentId, args.borrower, args.owner, args.house, args.vault, BigInt(args.sourceChain),
          args.collateralVault, args.collateralAsset, args.collateralAmount, args.returnRecipient, args.settlementAsset,
          args.limit, BigInt(args.maturity), args.revolving, args.bundleId, BigInt(args.setupDeadline), BigInt(args.grace),
          args.reservationBond, args.nonce, BigInt(args.expiry), args.termsHash,
          args.aprBps ?? 0n, args.originationFee ?? 0n, args.commitmentFeeBps ?? 0n,
        ],
      ),
    );
  }

  drawDigest(
    domain: `0x${string}`,
    creditId: `0x${string}`,
    amount: bigint,
    maxBound: bigint,
    nonce: bigint,
    deadline: number,
    revision: bigint,
  ): `0x${string}` {
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [domain, creditId, amount, maxBound, nonce, BigInt(deadline), revision],
      ),
    );
  }

  actionDigest(
    domain: `0x${string}`,
    creditId: `0x${string}`,
    target: `0x${string}`,
    data: `0x${string}`,
    amount: bigint,
    maxBound: bigint,
    nonce: bigint,
    deadline: number,
    revision: bigint,
  ): `0x${string}` {
    const actionHash = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [target, data]),
    );
    return keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" },
          { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        ],
        [domain, creditId, actionHash, amount, maxBound, nonce, BigInt(deadline), revision],
      ),
    );
  }

  signDigest(digest: `0x${string}`): Promise<`0x${string}`> {
    if (this.wallet.signDigest) return this.wallet.signDigest(digest);
    if (this.wallet.signMessage) return this.wallet.signMessage(digest);
    throw new Error("wallet-digest-signing-unavailable");
  }
}
