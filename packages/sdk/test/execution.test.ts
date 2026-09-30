import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, padHex, stringToHex } from "viem";
import { CreditApp } from "../src/app/app.js";
import type { TermbookClient } from "../src/client/client.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as const;
const word = (digit: string) => `0x${digit.repeat(64)}` as const;
const borrower = address("1");
const manager = address("2");
const asset = address("3");
const id = word("4");
const bundle = word("5");
const pendingId = word("6");

function fixture(pending = true) {
  const rpc = {
    creditDetails: vi.fn(async () => ({ facility: 4, borrower, account: address("7"), vault: address("8"),
      bundleId: bundle, debt: 0n, revision: 1n, nonce: 0n })),
    creditFreeCash: vi.fn(async () => 0n),
    currentHealth: vi.fn(async () => ({ value: null, state: "healthy" })),
    previewPlan: vi.fn(async () => ({ initialBps: 15_000n, healthBps: 20_000n, debt: 105n, recoveryValue: 210n })),
    coreWrite: vi.fn(async () => word("a")),
    wait: vi.fn(async () => ({ logs: pending ? [{ address: manager,
      topics: [keccak256(stringToHex("ActionPending(bytes32,bytes32,bytes32,bytes32)")), id, pendingId],
      data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [word("b"), word("c")]) }] : [] })),
    read: vi.fn(async (_address: string, _abi: unknown, name: string) => {
      if (name === "asset") return asset;
      if (name === "managedBundle" || name === "validateCall") return true;
      if (name === "integrationRegistry") return address("9");
      if (name === "executionManager") return manager;
      if (name === "executionDigest") return word("d");
      if (name === "sessions") return [bundle, word("b"), 105n, 210n, 0n, 500n, 1000n, 0n,
        BigInt(Math.floor(Date.now() / 1000) + 3600), 0n, 7n];
      throw new Error(name);
    }),
  };
  const client = { ready: async () => {}, rpc, config: { core: address("e"), versionId: bundle, actions: [{
    capability: "place_order", label: "Order", target: address("f"), signature: "function place(uint256 margin,uint256 notional)",
    arguments: [{ source: "input", path: "margin" }, { source: "input", path: "notional" }],
    fundingPath: "margin", exposurePath: "notional", settlement: "asynchronous", steps: [{ target: address("a"),
      signature: "function fee(uint256 amount)", arguments: [{ source: "input", path: "fee" }], fundingPath: "fee" }],
  }] }, signer: { address: () => borrower, signDigest: vi.fn(async () => word("f")) } } as unknown as TermbookClient;
  const action = { capability: "place_order", params: { margin: "100", notional: "500", fee: "5" } };
  return { client, rpc, action, app: new CreditApp(client, id) };
}

describe("managed SDK execution", () => {
  it("reviews all calls, finances fees, and returns the actual pending identifiers", async () => {
    const { rpc, app, action } = fixture();
    const result = await app.execute(action, await app.review(action));
    expect(result).toMatchObject({ status: "pending", draw: 105n, pendingIds: [pendingId] });
    const authorization = rpc.coreWrite.mock.calls[0] as unknown as [string, [string, unknown, { drawAmount: bigint; nonce: bigint; signer: string }]];
    expect(authorization[0]).toBe("executePlan");
    expect(authorization[1][2]).toMatchObject({ drawAmount: 105n, nonce: 1n, signer: borrower });
    expect(rpc.read.mock.calls.filter((call) => call[2] === "validateCall").map((call) => (call as unknown[])[3]))
      .toEqual(expect.arrayContaining([expect.arrayContaining([5n]), expect.arrayContaining([100n])]));
  });
  it("reports immediate completion even when the registered capability can be asynchronous", async () => {
    const { app, action } = fixture(false);
    expect(await app.execute(action)).toMatchObject({ status: "settled", pendingIds: [] });
  });
  it("binds a session signature to its separate onchain nonce", async () => {
    const { app, rpc, action } = fixture();
    const wallet = { address: address("b"), signTypedData: async () => word("b"), signDigest: vi.fn(async () => word("c")) };
    await app.execute(action, undefined, wallet);
    expect(wallet.signDigest).toHaveBeenCalledWith(word("d"));
    expect(rpc.coreWrite).toHaveBeenCalledWith("executePlan", [id, expect.anything(), expect.objectContaining({ nonce: 7n, signer: wallet.address })]);
  });
  it("rejects stale reviewed state before requesting a signature", async () => {
    const { app, action, client, rpc } = fixture();
    const review = await app.review(action);
    review.fingerprint = padHex("0x", { size: 32 });
    await expect(app.execute(action, review)).rejects.toThrow("action-review-stale");
    expect(client.signer.signDigest).not.toHaveBeenCalled();
    expect(rpc.coreWrite).not.toHaveBeenCalled();
  });
});
