import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { readAppState } from "../../src/credit/app-state.js";
import { monadClient } from "../../src/chain/monad.client.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { core: `0x${"1".repeat(40)}` } }));

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const creditId = id("a");
const bundleId = id("b");
const account = address("2");
const vault = address("3");
const reader = address("4");
const appReader = address("5");
const readerCode = "0x6000" as const;
const appCode = "0x6001" as const;

let count = 1n;
let appHash = keccak256(appCode);
let observedAt = 950n;
const readContract = vi.fn(async ({ functionName }: { functionName: string; blockNumber: bigint }) => {
  switch (functionName) {
    case "creditDetails": return { revision: 7n, account, vault, bundleId };
    case "healthSource": return address("6");
    case "readers": return [reader, 1n, true, 100n, keccak256(readerCode)];
    case "asset": return address("7");
    case "core": return address("1");
    case "bundleId": return bundleId;
    case "appReader": return appReader;
    case "appReaderCodeHash": return appHash;
    case "recoveryAdapter":
    case "appRecoveryAdapterOfBundle": return address("8");
    case "readAppValue": return [100n, 8_000, 10n, observedAt];
    case "positionCount":
    case "pendingCount": return count;
    case "positionAt": return [id("c"), id("d")];
    case "pendingAt": return [id("e"), id("c"), 40n, 1_100n];
    default: throw new Error("unexpected-read");
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  count = 1n;
  appHash = keccak256(appCode);
  observedAt = 950n;
  vi.mocked(monadClient).mockReturnValue({
    getBlock: async () => ({ number: 123n, timestamp: 1_000n }),
    getBytecode: async ({ address: target }: { address: string }) => target === reader ? readerCode : appCode,
    readContract,
  } as never);
});

describe("application state", () => {
  it("reads positions and pending actions from the pinned reader at one finalized block", async () => {
    expect(await readAppState(creditId, "positions")).toMatchObject({
      revision: "7", blockNumber: "123", positions: [{ positionId: id("c"), marketId: id("d") }],
    });
    expect(await readAppState(creditId, "pending")).toMatchObject({
      pending: [{ actionId: id("e"), positionId: id("c"), remainingLiability: "40", deadline: "1100" }],
    });
    expect(readContract.mock.calls.every(([call]) => call.blockNumber === 123n)).toBe(true);
  });

  it("rejects unbounded collections and changed reader code", async () => {
    count = 33n;
    await expect(readAppState(creditId, "positions")).rejects.toThrow("application-state-unavailable");
    count = 1n;
    appHash = id("f");
    await expect(readAppState(creditId, "pending")).rejects.toThrow("application-state-unavailable");
  });

  it("rejects stale app observations", async () => {
    observedAt = 800n;
    await expect(readAppState(creditId, "positions")).rejects.toThrow("application-state-unavailable");
  });
});
