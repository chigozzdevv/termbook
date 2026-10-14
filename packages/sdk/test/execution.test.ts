import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, keccak256, padHex, stringToHex } from "viem";
import { executionCoreAbi } from "../src/app/execution.js";
import { CreditApp } from "../src/app/app.js";
import type { TermbookClient } from "../src/client/client.js";
import * as pins from "../src/integration/pins.js";
import { standardDefinition } from "./use-case.fixture.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as const;
const word = (digit: string) => `0x${digit.repeat(64)}` as const;
const borrower = address("1");
const manager = address("2");
const asset = address("3");
const id = word("4");
const bundle = word("5");
const pendingId = word("6");

function fixture(pending = true) {
  let submitted: readonly unknown[];
  const rpc = {
    creditDetails: vi.fn(async () => ({ facility: 4, borrower, account: address("7"), vault: address("8"),
      bundleId: bundle, debt: 0n, revision: 1n, nonce: 0n })),
    creditFreeCash: vi.fn(async () => 0n),
    currentHealth: vi.fn(async () => ({ value: null, state: "healthy" })),
    previewPlan: vi.fn(async () => ({ initialBps: 15_000n, healthBps: 20_000n, debt: 105n, recoveryValue: 210n })),
    coreWrite: vi.fn(async (_name: string, args: readonly unknown[]) => { submitted = args; return word("a"); }),
    wait: vi.fn(async () => ({ blockNumber: 10n, blockHash: word("1"), status: "success", logs: pending ? [{ address: manager,
      topics: [keccak256(stringToHex("ActionPending(bytes32,bytes32,bytes32,bytes32)")), id, pendingId],
      data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [word("b"), word("c")]) }] : [] })),
    read: vi.fn(async (_address: string, _abi: unknown, name: string) => {
      if (name === "asset") return asset;
      if (name === "executionVersion") return 2n;
      if (name === "managedBundle" || name === "validateCall" || name === "validateValueCall") return true;
      if (name === "integrationRegistry") return address("9");
      if (name === "executionManager") return manager;
      if (name === "executionDigest") return word("d");
      if (name === "creditDetails") return { account: address("7"), bundleId: bundle };
      if (name === "records") return [word("b"), word("c"), 500n, 0, { positionId: word("c"), status: 3,
        committed: 105n, filled: 105n, refunded: 0n, remaining: 0n, liability: 0n }];
      if (name === "sessions") return [bundle, word("b"), 105n, 210n, 0n, 500n, 1000n, 0n,
        BigInt(Math.floor(Date.now() / 1000) + 3600), 0n, 7n];
      throw new Error(name);
    }),
  };
  const transport = { getChainId: async () => 143, getBlock: async () => ({ number: 10n, hash: word("1") }),
    getTransactionReceipt: rpc.wait, getTransaction: async () => ({ to: address("e"),
      input: encodeFunctionData({ abi: executionCoreAbi, functionName: "executePlan", args: submitted as never }) }) };
  const client = { ready: async () => {}, rpc: { ...rpc, client: transport }, config: { core: address("e"), chainId: 143, versionId: bundle, actions: [{
    capability: "place_order", label: "Order", target: address("f"), signature: "function place(uint256 margin,uint256 notional)",
    arguments: [{ source: "input", path: "margin" }, { source: "input", path: "notional" }],
    fundingPath: "margin", exposurePath: "notional", settlement: "asynchronous", steps: [{ target: address("a"),
      signature: "function fee(uint256 amount)", arguments: [{ source: "input", path: "fee" }], fundingPath: "fee" }],
  }] }, signer: { address: () => borrower, signDigest: vi.fn(async () => word("f")) } } as unknown as TermbookClient;
  const action = { capability: "place_order", params: { margin: "100", notional: "500", fee: "5" } };
  return { client, rpc, action, app: new CreditApp(client, id) };
}

describe("managed SDK execution", () => {
  it("skips repeated testnet source audits but retains permission and health enforcement", async () => {
    const { client, rpc, app, action } = fixture(false);
    client.config.chainId = 10143;
    client.config.integration_definition = standardDefinition();
    const verify = vi.spyOn(pins, "verify_definition").mockRejectedValue(new Error("source-audit"));
    try {
      await expect(app.review(action)).resolves.toMatchObject({ canExecute: true });
      expect(verify).not.toHaveBeenCalled();
      expect(rpc.currentHealth).toHaveBeenCalled();
      expect(rpc.previewPlan).toHaveBeenCalled();
      rpc.previewPlan.mockResolvedValue({ initialBps: 15_000n, healthBps: 10_000n, debt: 105n, recoveryValue: 105n });
      await expect(app.execute(action)).rejects.toThrow("action-health-insufficient");
      expect(rpc.coreWrite).not.toHaveBeenCalled();
      const read = rpc.read.getMockImplementation()!;
      rpc.read.mockImplementation(async (address, abi, name) => name === "validateValueCall" ? false as never : read(address, abi, name));
      await expect(app.review(action)).rejects.toThrow("capability-denied");
      client.config.chainId = 143;
      await expect(app.review(action)).rejects.toThrow("source-audit");
      expect(verify).toHaveBeenCalledTimes(1);
    } finally { verify.mockRestore(); }
  });
  it("keeps place_order unprefixed and validates its use case before reading or signing", async () => {
    const { client, rpc, app, action } = fixture(false);
    client.config.use_case = "perps";
    await expect(app.execute({ ...action, use_case: "spot" } as never)).rejects.toThrow("action-use-case-mismatch");
    expect(rpc.creditDetails).not.toHaveBeenCalled();
    expect(client.signer.signDigest).not.toHaveBeenCalled();
    expect(rpc.coreWrite).not.toHaveBeenCalled();
    client.config.actions = [{ capability: "place_order", label: "Place", target: address("f"), settlement: "atomic",
      signature: "function place(uint256 market,uint8 direction,uint256 margin,uint256 notional,uint256 bps)",
      arguments: [{ source: "input", path: "market_id" }, { source: "input", path: "direction", choices: { long: "1", short: "2" } },
        { source: "input", path: "amount.margin" }, { source: "input", path: "amount.notional" }, { source: "input", path: "slippage_bps" }],
      when: { order_type: "market" }, fundingPath: "amount.margin", exposurePath: "amount.notional" }];
    await expect(app.execute({ use_case: "perps", capability: "place_order", params: { market_id: "1", direction: "long", order_type: "market",
      amount: { margin: "105", notional: "500" }, slippage_bps: 50 } })).resolves.toMatchObject({ status: "settled", draw: 105n });
  });

  it("requires a known integration use case for an explicitly typed action", async () => {
    const { app, rpc, action } = fixture(false);
    await expect(app.review({ ...action, use_case: "perps" } as never)).rejects.toThrow("action-use-case-unavailable");
    expect(rpc.creditDetails).not.toHaveBeenCalled();
  });

  it("spends owned USDC without authorizing another loan", async () => {
    const { client, rpc, app } = fixture(false);
    client.config.actions = [{ capability: "spend", label: "Spend USDC", target: address("f"), signature: "function spend(uint256 amount)",
      arguments: [{ source: "input", path: "amount" }], spendPath: "amount", spendToken: asset, settlement: "atomic" }];
    rpc.creditFreeCash.mockResolvedValue(100n);
    const action = { capability: "spend", params: { amount: "100" } };
    const review = await app.review(action);
    expect(review.requiredInput).toBe(100n); expect(review.draw).toBe(0n);
    expect(rpc.previewPlan).toHaveBeenCalledWith(id, expect.objectContaining({ requiredInput: 100n }), 0n, 1n, expect.anything());
    rpc.creditFreeCash.mockResolvedValue(99n);
    await expect(app.review(action)).rejects.toThrow("action-owned-cash-insufficient");
  });
  it("reviews all calls, finances fees, and returns the actual pending identifiers", async () => {
    const { rpc, app, action } = fixture();
    const result = await app.execute(action, await app.review(action));
    expect(result).toMatchObject({ status: "settled", draw: 105n, pendingIds: [pendingId], outcomes: [{ filled: 105n }] });
    const authorization = rpc.coreWrite.mock.calls[0] as unknown as [string, [string, unknown, { drawAmount: bigint; nonce: bigint; signer: string }]];
    expect(authorization[0]).toBe("executePlan");
    expect(authorization[1][2]).toMatchObject({ drawAmount: 105n, nonce: 1n, signer: borrower });
    expect(rpc.read.mock.calls.filter((call) => call[2] === "validateValueCall").map((call) => (call as unknown[])[3]))
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
