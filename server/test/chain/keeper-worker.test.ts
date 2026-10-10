import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../src/config/env.js";
import { reconcileKeeperWallet } from "../../src/chain/keeper.js";
import { runKeeperWorker } from "../../src/chain/keeper.worker.js";
import { monadClient } from "../../src/chain/monad.client.js";

const clients = vi.hoisted(() => ({ monad: { name: "monad" }, ethereum: { name: "ethereum" } }));
vi.mock("viem", async (load) => ({ ...await load<typeof import("viem")>(), createPublicClient: () => clients.ethereum }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: {
  monadChainId: 143, rpcUrl: "http://monad", sourceRpcUrl: "http://ethereum",
  settlementKeeperKey: "", sourceWormholePublisherKey: "",
} }));
vi.mock("../../src/chain/keeper.js", () => ({ reconcileKeeperWallet: vi.fn() }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(monadClient).mockReturnValue(clients.monad as never);
  env.monadChainId = 143;
  env.settlementKeeperKey = "";
  env.sourceWormholePublisherKey = "";
  for (const name of ["RISK_KEEPER_KEY", "RECOVERY_RELAY_KEY", "SOURCE_RECOVERY_RELAY_KEY", "ORACLE_KEEPER_KEY", "UPGRADE_MONITOR_KEY"]) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("keeper reconciliation loop", () => {
  it("reconciles time-sensitive monitor and oracle wallets with priority", async () => {
    vi.stubEnv("UPGRADE_MONITOR_KEY", `0x${"3".repeat(64)}`);
    vi.stubEnv("ORACLE_KEEPER_KEY", `0x${"4".repeat(64)}`);
    vi.mocked(reconcileKeeperWallet).mockResolvedValue("idle");
    await runKeeperWorker();
    expect(monadClient).toHaveBeenCalledWith(2);
    expect(monadClient).toHaveBeenCalledWith(1);
  });
  it("reconciles Ethereum testnet transactions on Sepolia", async () => {
    env.monadChainId = 10143;
    const key = `0x${"2".repeat(64)}` as const;
    env.sourceWormholePublisherKey = key;
    vi.mocked(reconcileKeeperWallet).mockResolvedValue("success");
    expect(await runKeeperWorker()).toBe(1);
    expect(reconcileKeeperWallet).toHaveBeenCalledWith(clients.ethereum, 11155111, privateKeyToAccount(key).address);
  });
  it("does nothing when no durable keeper wallet is configured", async () => {
    expect(await runKeeperWorker()).toBe(0);
    expect(reconcileKeeperWallet).not.toHaveBeenCalled();
  });

  it("uses each wallet's chain and isolates an RPC failure from other pending transactions", async () => {
    const monadKey = `0x${"1".repeat(64)}` as const;
    const ethereumKey = `0x${"2".repeat(64)}` as const;
    env.settlementKeeperKey = monadKey;
    env.sourceWormholePublisherKey = ethereumKey;
    vi.mocked(reconcileKeeperWallet).mockRejectedValueOnce(new Error("rpc-unavailable"))
      .mockResolvedValueOnce("success");
    expect(await runKeeperWorker()).toBe(1);
    expect(reconcileKeeperWallet).toHaveBeenNthCalledWith(1, clients.monad, 143, privateKeyToAccount(monadKey).address);
    expect(reconcileKeeperWallet).toHaveBeenNthCalledWith(2, clients.ethereum, 1, privateKeyToAccount(ethereumKey).address);
  });
});
