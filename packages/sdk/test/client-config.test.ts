import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "viem";
import { create_termbook } from "../src/client/client.js";

vi.mock("viem", async (original) => {
  const actual = await original<typeof import("viem")>();
  return { ...actual, createPublicClient: vi.fn() };
});

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const token = `tbk_${"a".repeat(64)}`;
const versionId = `0x${"b".repeat(64)}`;
const wallet = { address: address("1"), signTypedData: async () => `0x${"c".repeat(64)}` as `0x${string}`,
  getChainId: async () => 143 };
const actions = [{ capability: "place_order", label: "Place order", target: address("6"),
  signature: "function placeOrder(uint256 amount,address account)",
  arguments: [{ source: "input", path: "amount", label: "Amount" }, { source: "credit_account" }],
  fundingPath: "amount", settlement: "atomic" }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("public SDK configuration", () => {
  function setup(active = true) {
    vi.stubEnv("TERMBOOK_PUBLIC_API_BASE", "https://api.termbook.example");
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({
      appToken: token, versionId, core: address("2"), chainId: 143,
      rpcUrl: "https://rpc.termbook.example", apiBase: "https://api.termbook.example",
      accountFactory: address("3"), riskEngine: address("4"), actions,
    }) }));
    vi.stubGlobal("fetch", fetcher);
    const chain = {
      getChainId: vi.fn(async () => 143), getBytecode: vi.fn(async () => "0x1234"),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "integrationRegistry") return address("5");
        if (functionName === "riskEngine") return address("4");
        if (functionName === "isActive") return active;
        if (functionName === "isCallAllowed") return true;
        throw new Error("unexpected-read");
      }),
    };
    vi.mocked(createPublicClient).mockReturnValue(chain as never);
    return { fetcher, chain };
  }

  it("resolves an admitted token once for concurrent use", async () => {
    const { fetcher, chain } = setup();
    const client = create_termbook({ app_token: token, wallet });
    await Promise.all([client.ready(), client.ready()]);
    expect(client.config.core).toBe(address("2"));
    expect(client.config.riskEngine).toBe(address("4"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(chain.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "isActive", blockTag: "finalized" }));
  });

  it("rejects a revoked integration", async () => {
    setup(false);
    const client = create_termbook({ app_token: token, wallet });
    await expect(client.ready()).rejects.toThrow("sdk-config-invalid");
    expect(() => client.rpc).toThrow("client-not-ready");
  });

  it("rejects a different API origin in a config response", async () => {
    setup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
      appToken: token, versionId, core: address("2"), chainId: 143,
      rpcUrl: "https://rpc.termbook.example", apiBase: "https://other.example",
      accountFactory: address("3"), riskEngine: address("4"),
    }) })));
    await expect(create_termbook({ app_token: token, wallet }).ready()).rejects.toThrow("sdk-config-invalid");
    expect(createPublicClient).not.toHaveBeenCalled();
  });

  it("sends the app token with wallet-authorized intent requests", async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () =>
      url.endsWith("/auth/nonce") ? { message: "login" } : { intentId: versionId } }));
    vi.stubGlobal("fetch", fetcher);
    const client = create_termbook({ app_token: token, wallet: { ...wallet, signMessage: async () => versionId as `0x${string}` },
      core: address("2"), rpcUrl: "https://rpc.termbook.example", chainId: 143,
      apiBase: "https://api.termbook.example" });
    await client.authenticatedPost("/intents", { borrower: wallet.address });
    expect(fetcher).toHaveBeenLastCalledWith("https://api.termbook.example/intents",
      expect.objectContaining({ headers: expect.objectContaining({ "x-termbook-app-token": token }) }));
  });
});
