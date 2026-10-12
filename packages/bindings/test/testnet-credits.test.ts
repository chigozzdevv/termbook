import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCredits } from "../../../scripts/testnet-credits.mjs";

const archive = vi.hoisted(() => ({
  read: vi.fn(), env: { monadChainId: 10143, core: "core" },
}));
vi.mock("../../../server/dist/chain/envio.client.js", () => ({ readCoreEvents: archive.read }));
vi.mock("../../../server/dist/config/env.js", () => ({ env: archive.env }));
vi.mock("../../../scripts/testnet-runtime.mjs", () => ({
  artifact: () => ({ abi: [{ type: "event", name: "CreditCreated" }] }),
  viem: { toEventSelector: () => `0x${"1".repeat(64)}`, decodeEventLog: ({ data }: { data: string }) => ({ args: { creditId: data } }) },
}));

vi.stubEnv("ENVIO_API_TOKEN", "");
afterEach(() => {
  vi.stubEnv("ENVIO_API_TOKEN", "");
  archive.env.monadChainId = 10143;
  archive.read.mockReset();
});

function fixture(count = 2n) {
  const client = {
    getBlock: vi.fn(async () => ({ number: 200n, hash: "canonical" })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "acceptedCredits" ? count : { account: "account", lockId: "lock" }),
    getLogs: vi.fn(async () => [{ args: { creditId: "first" } }, { args: { creditId: "second" } }]),
  };
  const deployment = { addresses: { 10143: { TermbookCore: "core" } }, deploymentBlocks: { 10143: "1" } };
  return { client, deployment };
}

describe("onchain credit inventory", () => {
  it("discovers credits without old E2E reports", async () => {
    const { client, deployment } = fixture();
    const result = await loadCredits(deployment, { client });
    expect(result.observations.map((credit: { creditId: string }) => credit.creditId)).toEqual(["first", "second"]);
    expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 200n }));
  });

  it.each([1n, 3n])("rejects an incomplete event inventory", async (count) => {
    const { client, deployment } = fixture(count);
    await expect(loadCredits(deployment, { client })).rejects.toThrow("inventory is incomplete");
  });

  it("rejects duplicate credit events", async () => {
    const { client, deployment } = fixture();
    client.getLogs.mockResolvedValue([{ args: { creditId: "first" } }, { args: { creditId: "first" } }]);
    await expect(loadCredits(deployment, { client })).rejects.toThrow("inventory is incomplete");
  });

  it("rejects a changed canonical block", async () => {
    const { client, deployment } = fixture();
    client.getBlock.mockResolvedValueOnce({ number: 200n, hash: "canonical" }).mockResolvedValueOnce({ number: 200n, hash: "changed" });
    await expect(loadCredits(deployment, { client })).rejects.toThrow("block changed");
  });

  it("does not recursively retry a transport failure", async () => {
    const { client, deployment } = fixture();
    client.getLogs.mockRejectedValue(new Error("Connection refused"));
    await expect(loadCredits(deployment, { client })).rejects.toThrow("Connection refused");
    expect(client.getLogs).toHaveBeenCalledTimes(1);
  });

  it("splits a provider range limit without losing events", async () => {
    const { client, deployment } = fixture();
    client.getLogs.mockRejectedValueOnce(new Error("Block range limit exceeded"))
      .mockResolvedValueOnce([{ args: { creditId: "first" } }])
      .mockResolvedValueOnce([{ args: { creditId: "second" } }]);
    expect((await loadCredits(deployment, { client })).observations).toHaveLength(2);
    expect(client.getLogs).toHaveBeenCalledTimes(3);
  });

  it("accepts an alternate log provider only at the same canonical block", async () => {
    const { client, deployment } = fixture();
    const logClient = { getChainId: vi.fn(async () => 10143), getBlock: client.getBlock, getLogs: client.getLogs };
    expect((await loadCredits(deployment, { client, logClient })).observations).toHaveLength(2);
    logClient.getChainId.mockResolvedValueOnce(143);
    await expect(loadCredits(deployment, { client, logClient })).rejects.toThrow("provider chain or block mismatch");
  });

  it("rejects a log provider on a different fork", async () => {
    const { client, deployment } = fixture();
    const logClient = { getChainId: vi.fn(async () => 10143), getBlock: vi.fn(async () => ({ hash: "different" })), getLogs: client.getLogs };
    await expect(loadCredits(deployment, { client, logClient })).rejects.toThrow("provider chain or block mismatch");
    expect(client.getLogs).not.toHaveBeenCalled();
  });

  it("uses receipt-verified archive pages while checking the onchain inventory", async () => {
    vi.stubEnv("ENVIO_API_TOKEN", "test");
    const { client, deployment } = fixture();
    archive.read.mockResolvedValueOnce({ source: "envio", nextBlock: 100n, logs: [{ data: "first" }] })
      .mockResolvedValueOnce({ source: "envio", nextBlock: 201n, logs: [{ data: "second" }] });
    expect((await loadCredits(deployment, { client })).observations).toHaveLength(2);
    expect(archive.read).toHaveBeenNthCalledWith(2, client, 100n, 200n, "json", `0x${"1".repeat(64)}`);
    expect(client.getLogs).not.toHaveBeenCalled();
  });

  it("rejects archive configuration from a different chain", async () => {
    vi.stubEnv("ENVIO_API_TOKEN", "test");
    archive.env.monadChainId = 143;
    const { client, deployment } = fixture();
    await expect(loadCredits(deployment, { client })).rejects.toThrow("configuration mismatch");
    expect(archive.read).not.toHaveBeenCalled();
  });

  it("uses an explicitly selected RPC only after checking its chain and canonical block", async () => {
    vi.stubEnv("ENVIO_API_TOKEN", "test");
    const { client, deployment } = fixture();
    const logClient = { getChainId: vi.fn(async () => 10143), getBlock: client.getBlock, getLogs: client.getLogs };
    expect((await loadCredits(deployment, { client, logClient })).observations).toHaveLength(2);
    expect(archive.read).not.toHaveBeenCalled();
  });

  it("rejects an archive that has not caught up", async () => {
    vi.stubEnv("ENVIO_API_TOKEN", "test");
    const { client, deployment } = fixture();
    archive.read.mockResolvedValue({ source: "envio", nextBlock: 1n, logs: [] });
    await expect(loadCredits(deployment, { client })).rejects.toThrow("has not caught up");
  });

  it("rejects an incomplete archive without falling back to unverified logs", async () => {
    vi.stubEnv("ENVIO_API_TOKEN", "test");
    const { client, deployment } = fixture();
    archive.read.mockResolvedValue({ source: "envio", nextBlock: 201n, logs: [{ data: "first" }] });
    await expect(loadCredits(deployment, { client })).rejects.toThrow("inventory is incomplete");
    expect(client.getLogs).not.toHaveBeenCalled();
  });
});
