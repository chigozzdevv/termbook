import { describe, expect, it, vi } from "vitest";
import { closeCredit, ClosurePendingError, ClosureFundingRequiredError } from "../src/credit/closure.js";
import type { TermbookClient } from "../src/client/client.js";

const id = `0x${"1".repeat(64)}` as const;
const word = `0x${"2".repeat(64)}` as const;
const core = `0x${"3".repeat(40)}` as const;
const borrower = `0x${"4".repeat(40)}` as const;
const asset = `0x${"5".repeat(40)}` as const;

function fixture(remote = false) {
  const state = { facility: 4, debt: 200n, cash: 0n, positions: 200n,
    pending: 0n, collateralReturned: false, delivery: false };
  const rpc = {
    creditDetails: vi.fn(async () => ({ facility: state.facility, debt: state.debt,
      vault: core, account: borrower, collateralAmount: state.collateralReturned ? 0n : 100n,
      collateralReturned: state.collateralReturned, lockId: word })),
    debt: vi.fn(async () => state.debt),
    creditFreeCash: vi.fn(async () => state.cash),
    wait: vi.fn(async () => ({ status: "success" })),
    ethereumWormholeFee: vi.fn(async () => 0n),
    read: vi.fn(async (_address: string, _abi: unknown, name: string) => {
      if (name === "managedBundle") return false;
      if (name === "closeStep") return [word, "0x01", state.positions === 0n, 0n];
      if (name === "remoteCollateral") return remote;
      if (name === "solanaCollateral") return false;
      if (name === "pendingRemoteReturn") return state.pending;
      if (name === "remoteReturnActionHash") return word;
      if (name === "asset") return asset;
      throw new Error(name);
    }),
    coreWrite: vi.fn(async (name: string, args: readonly unknown[]) => {
      if (name === "startClosing") state.facility = 5;
      else if (name === "advanceClose") { state.positions = 0n; state.cash = 250n; }
      else if (name === "repayAvailableCash") {
        const payment = state.cash < state.debt ? state.cash : state.debt;
        state.cash -= payment; state.debt -= payment;
      } else if (name === "withdraw") state.cash -= args[3] as bigint;
      else if (name === "authorizeReturn") {
        if (remote) state.pending = 100n;
        else state.collateralReturned = true;
      } else if (name === "finishClose") {
        if (!state.collateralReturned || state.debt !== 0n || state.positions !== 0n) throw new Error("unsafe-close");
        state.facility = 6;
      } else throw new Error(name);
      return word;
    }),
  };
  const client = { ready: async () => {}, config: { core, chainId: 143 },
    signer: { address: () => borrower }, rpc, authenticatedPost: vi.fn(async () => { state.delivery = true; })
  } as unknown as TermbookClient;
  return { client, rpc, state };
}

describe("closure coordinator", () => {
  it("freezes, unwinds, repays actual cash, pays surplus, returns collateral and closes", async () => {
    const { client, rpc, state } = fixture();
    expect(await closeCredit(client, id)).toMatchObject({ closed: true });
    expect(rpc.coreWrite.mock.calls.map(([name]) => name)).toEqual([
      "startClosing", "advanceClose", "repayAvailableCash", "withdraw", "authorizeReturn", "finishClose",
    ]);
    expect(rpc.coreWrite).toHaveBeenCalledWith("withdraw", [id, asset, borrower, 50n], undefined);
    expect(state.debt).toBe(0n);
    expect(state.cash).toBe(0n);
  });

  it("keeps a deficit frozen without releasing collateral", async () => {
    const { client, rpc, state } = fixture();
    state.positions = 0n;
    await expect(closeCredit(client, id)).rejects.toMatchObject({
      message: "close-funding-required", shortfall: 200n,
    });
    expect(state.facility).toBe(5);
    expect(rpc.coreWrite.mock.calls.map(([name]) => name)).toEqual(["startClosing"]);
    expect(ClosureFundingRequiredError.prototype).toBeInstanceOf(ClosurePendingError);
  });

  it("waits for source confirmation and schedules the same remote return once", async () => {
    const { client, rpc, state } = fixture(true);
    let polls = 0;
    const original = rpc.creditDetails.getMockImplementation()!;
    rpc.creditDetails.mockImplementation(async () => {
      if (state.delivery && ++polls > 1) { state.collateralReturned = true; state.pending = 0n; }
      return original();
    });
    expect(await closeCredit(client, id, { pollIntervalMs: 1, timeoutMs: 1000 })).toMatchObject({ closed: true });
    expect(client.authenticatedPost).toHaveBeenCalledTimes(1);
    expect(rpc.coreWrite.mock.calls.filter(([name]) => name === "authorizeReturn")).toHaveLength(1);
    expect(polls).toBeGreaterThan(1);
  });

  it("resumes a timed-out return without another transfer or scheduling authorization", async () => {
    const { client, rpc, state } = fixture(true);
    let pending: ClosurePendingError | undefined;
    try { await closeCredit(client, id, { timeoutMs: 15, pollIntervalMs: 2 }); }
    catch (error) { if (error instanceof ClosurePendingError) pending = error; else throw error; }
    expect(pending?.checkpoint.stage).toBe("return_pending");
    expect(pending?.checkpoint.remoteScheduled).toBe(true);
    state.collateralReturned = true; state.pending = 0n;
    expect(await closeCredit(client, id, { checkpoint: pending!.checkpoint })).toMatchObject({ closed: true });
    expect(client.authenticatedPost).toHaveBeenCalledTimes(1);
    expect(rpc.coreWrite.mock.calls.filter(([name]) => name === "authorizeReturn")).toHaveLength(1);
  });

  it("rejects another credit's checkpoint before sending transactions", async () => {
    const { client, rpc } = fixture();
    await expect(closeCredit(client, id, { checkpoint: { chainId: 143, core, creditId: word,
      stage: "return_pending" } })).rejects.toThrow("close-checkpoint-invalid");
    expect(rpc.coreWrite).not.toHaveBeenCalled();
  });
});
