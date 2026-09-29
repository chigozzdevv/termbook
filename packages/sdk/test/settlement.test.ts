import { describe, expect, it, vi } from "vitest";
import { unconsumed } from "../src/settlement/receipt.js";
import { Settlement } from "../src/settlement/settlement.js";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";
import type { TermbookClient } from "../src/client/client.js";
import type { Wallet } from "../src/types/client.types.js";

vi.mock("@defuse-protocol/one-click-sdk-typescript", () => ({
  verifyQuoteSignature: vi.fn(() => true),
  quoteHash: vi.fn(() => "signed-quote"),
}));

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const word = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;

function fixture(format: "evm" | "solana", depositAddress: string, sourceRefundRecipient: string,
  quoteDeadline?: string) {
  const inbox = address("e");
  const payer = address("a");
  const deadline = Math.floor(Date.now() / 1000) + 900;
  const rpc = {
    read: vi.fn().mockResolvedValue(inbox),
    client: { readContract: vi.fn().mockResolvedValue(inbox) },
    write: vi.fn(), wait: vi.fn(),
  };
  const authenticatedPost = vi.fn().mockImplementation(async (_path: string, body: { operationId: string; sourceRefundRecipient: string }) => ({
    operationId: body.operationId,
    inbox,
    quote: {
      quoteRequest: { recipient: inbox, refundTo: body.sourceRefundRecipient, amount: "100" },
      quote: { depositAddress, amountIn: "100", amountOut: "90", minAmountOut: "90",
        deadline: quoteDeadline ?? new Date((deadline - 60) * 1000).toISOString() },
    },
  }));
  const client = {
    ready: async () => {},
    config: { chainId: 143, settlementFactory: address("f") },
    signer: { address: () => payer, sign: vi.fn() },
    rpc, authenticatedPost,
  } as unknown as TermbookClient;
  const input = {
    kind: "recovery" as const, payer, nonce: 1n, chainId: 900, creditId: word("1"),
    routeVersion: word("2"), routeId: word("3"), asset: address("4"),
    settlementAsset: address("5"), vault: address("6"), maxAmountIn: 100n,
    minAmountOut: 80n, maxReceived: 120n, deadline, sourceRefund: address("7"),
    sourceAddressFormat: format, sourceRefundRecipient, monadRefund: address("8"),
    registrationTxHash: word("9"),
  };
  return { settlement: new Settlement(client), input, rpc, authenticatedPost };
}

describe("settlement", () => {
  it("revises only the next LP authorization and enforces the payer wallet", async () => {
    const { settlement, rpc } = fixture("evm", address("2"), address("7"));
    const zero = word("0");
    rpc.read.mockImplementation(async (_address: string, _abi: unknown, name: string) => {
      if (name === "creditId") return zero;
      if (name === "lpAuthorizer") return address("a");
      if (name === "lpRevision") return 4n;
      throw new Error(name);
    });
    rpc.write.mockResolvedValue(word("9"));
    const deadline = Math.floor(Date.now() / 1000) + 600;
    expect(await settlement.reviseLp(address("e"), {
      minAmount: 80n, maxAmount: 100n, minShares: 90n, deadline,
    })).toMatchObject({ revision: 5n });
    expect(rpc.write).toHaveBeenCalledWith(address("e"), expect.anything(), "reviseLp",
      [80n, 100n, 90n, BigInt(deadline), 5n, BigInt(deadline), "0x"]);
    rpc.read.mockResolvedValueOnce(zero).mockResolvedValueOnce(address("b"));
    await expect(settlement.cancelLp(address("e"))).rejects.toThrow("lp-payer-required");
    expect(rpc.write).toHaveBeenCalledTimes(1);
  });

  it("tracks shortfall", () => {
    expect(unconsumed({ received: 900n, applied: 900n, refunded: 0n })).toBe(0n);
  });

  it("registers native Solana refund and deposit addresses while preserving the EVM operation alias", async () => {
    const refund = solanaPubkeyBase58(word("1"));
    const deposit = solanaPubkeyBase58(word("2"));
    const { settlement, input, authenticatedPost } = fixture("solana", deposit, refund);
    const registration = await settlement.register(input);

    expect(registration).toMatchObject({
      sourceAddressFormat: "solana", sourceRefund: input.sourceRefund,
      sourceRefundRecipient: refund, depositAddress: deposit,
    });
    expect(registration.operation?.sourceRefund).toBe(input.sourceRefund);
    expect(authenticatedPost).toHaveBeenCalledWith("/settlement", expect.objectContaining({
      sourceRefundRecipient: refund,
    }));
  });

  it("rejects invalid Solana source addresses before registration", async () => {
    const { settlement, input, rpc } = fixture("solana", address("1"), "invalid0");
    await expect(settlement.register(input)).rejects.toThrow("settlement-route-required");
    expect(rpc.read).not.toHaveBeenCalled();
  });

  it("rejects an EVM deposit quote for a Solana route", async () => {
    const refund = solanaPubkeyBase58(word("1"));
    const { settlement, input } = fixture("solana", address("1"), refund);
    await expect(settlement.register(input)).rejects.toThrow("settlement-invalid");
  });

  it("rejects a signed quote with an unparseable deadline", async () => {
    const { settlement, input } = fixture("evm", address("2"), address("7"), "not-a-date");
    await expect(settlement.register(input)).rejects.toThrow("settlement-invalid");
  });

  it("preserves the EVM registration and rejects native routes in EVM funding helpers", async () => {
    const evm = fixture("evm", address("2"), address("7"));
    const evmRegistration = await evm.settlement.register(evm.input);
    expect(evmRegistration).toMatchObject({
      sourceAddressFormat: "evm", sourceRefundRecipient: evm.input.sourceRefund,
      depositAddress: address("2"),
    });

    const refund = solanaPubkeyBase58(word("1"));
    const deposit = solanaPubkeyBase58(word("2"));
    const native = fixture("solana", deposit, refund);
    const registration = await native.settlement.register(native.input);
    const writeContract = vi.fn();
    const wallet = { address: native.input.payer, writeContract } as unknown as Wallet;
    await expect(native.settlement.fundErc20(registration, "https://source.example", wallet))
      .rejects.toThrow("source-wallet-required");
    await expect(native.settlement.recoveryFunding(registration, native.input.sourceRefund,
      native.input.creditId, 1n, native.input.deadline - 120)).rejects.toThrow("recovery-route-invalid");
    await expect(native.settlement.fundRecovery(registration, native.input.sourceRefund, {
      creditId: native.input.creditId, operationId: registration.operationId, inbox: registration.inbox,
      depositAddress: address("2"), amount: 100n, quoteHash: word("3"), nonce: 1n,
      deadline: BigInt(native.input.deadline - 120),
    }, { header: "0x01", proof: "0x01", routeSignature: "0x01", riskSignature: "0x01" },
    "https://source.example", wallet)).rejects.toThrow("recovery-route-invalid");
    expect(writeContract).not.toHaveBeenCalled();
  });
});
