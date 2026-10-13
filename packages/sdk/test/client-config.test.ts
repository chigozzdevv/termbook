import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "viem";
import { create_termbook } from "../src/client/client.js";
import { rpcHttp } from "../src/transport/http.js";

vi.mock("viem", async (original) => {
  const actual = await original<typeof import("viem")>();
  return { ...actual, createPublicClient: vi.fn() };
});

describe("SDK RPC request pacing", () => {
  it("shares the call budget across clients and counts calls inside batches", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const sent: { time: number; count: number }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const requests = JSON.parse(String(init.body));
      sent.push({ time: Date.now(), count: requests.length });
      return Response.json(requests.map((item: { id: number }) => ({ jsonrpc: "2.0", id: item.id, result: "0x279f" })));
    }));
    const first = rpcHttp("https://rpc.termbook.example/pacing")({} as never);
    const second = rpcHttp("https://rpc.termbook.example/pacing")({} as never);
    const result = Promise.all(Array.from({ length: 64 }, (_, index) => (index % 2 ? first : second).request({ method: "eth_chainId" })));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toHaveLength(64);
    expect(sent.reduce((sum, batch) => sum + batch.count, 0)).toBe(64);
    expect(sent.every((batch) => batch.count <= 8)).toBe(true);
    for (let index = 1; index < sent.length; index++) {
      expect(sent[index]!.time - sent[index - 1]!.time).toBeGreaterThanOrEqual(sent[index - 1]!.count * 125);
    }
  });
});

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const token = `tbk_${"a".repeat(64)}`;
const versionId = `0x${"b".repeat(64)}`;
const wallet = { address: address("1"), signTypedData: async () => `0x${"c".repeat(64)}` as `0x${string}`,
  getChainId: async () => 143 };
const actions = [{ capability: "place_order", label: "Place order", target: address("6"),
  signature: "function placeOrder(uint256 margin,uint256 notional,uint8 direction,uint256 price,bytes32 market,address account)",
  arguments: [{ source: "input", path: "amount.margin" }, { source: "input", path: "amount.notional" },
    { source: "input", path: "direction", choices: { long: "1", short: "2" } }, { source: "price_bound" },
    { source: "input", path: "market_id" }, { source: "credit_account" }],
  fundingPath: "amount.margin", marketPath: "market_id", when: { order_type: "market" }, settlement: "atomic",
  price: { slippagePath: "slippage_bps", directionPath: "direction", maximumDirections: ["long"], minimumDirections: ["short"], markets: [versionId] } }];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("public SDK configuration", () => {
  function setup(active = true, overrides: Record<string, unknown> = {}) {
    vi.stubEnv("TERMBOOK_PUBLIC_API_BASE", "https://api.termbook.example");
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({
      appToken: token, versionId, core: address("2"), chainId: 143,
      rpcUrl: "https://rpc.termbook.example", apiBase: "https://api.termbook.example",
      accountFactory: address("3"), riskEngine: address("4"), settlementAsset: address("7"), use_case: "perps", actions, ...overrides,
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
    expect(client.config.settlementAsset).toBe(address("7"));
    expect(client.config.use_case).toBe("perps");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(chain.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "isActive", blockTag: "finalized" }));
  });

  it("resolves through a configured API while checking the returned origin", async () => {
    const { fetcher } = setup(true, { apiBase: "http://127.0.0.1:3002" });
    const client = create_termbook({ app_token: token, wallet, apiBase: "http://127.0.0.1:3002" });
    await client.ready();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:3002/integrations/config"), expect.anything());
    setup();
    await expect(create_termbook({ app_token: token, wallet, apiBase: "http://127.0.0.1:3002" }).ready()).rejects.toThrow("sdk-config-invalid");
  });

  it("waits for full deployment verification when it exceeds ten seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      const controller = new AbortController(); setTimeout(() => controller.abort(), delay); return controller.signal;
    });
    const { fetcher } = setup(), response = await fetcher();
    vi.stubGlobal("fetch", vi.fn((_url: string, request: { signal: AbortSignal }) => new Promise((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new Error("request timeout")); };
      const timer = setTimeout(() => { request.signal.removeEventListener("abort", aborted); resolve(response); }, 20_000);
      request.signal.addEventListener("abort", aborted, { once: true });
    })));
    const ready = expect(create_termbook({ app_token: token, wallet }).ready()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(20_000); await ready;
  });

  it("rejects missing or unknown integration use cases", async () => {
    for (const use_case of [undefined, "unknown"]) {
      setup(true, { use_case });
      await expect(create_termbook({ app_token: token, wallet }).ready()).rejects.toThrow("sdk-config-invalid");
    }
    expect(createPublicClient).not.toHaveBeenCalled();
  });

  it("rejects an override of the published use case", async () => {
    setup();
    await expect(create_termbook({ app_token: token, wallet, use_case: "spot" }).ready()).rejects.toThrow("sdk-config-invalid");
    expect(createPublicClient).not.toHaveBeenCalled();
  });

  it("checks preceding calls and accepts approved payable calls", async () => {
    const { chain } = setup(true, { use_case: "spot", actions: [{ capability: "place_order", label: "Buy token", target: address("6"),
      signature: "function buy(uint256 amount,uint256 minOutput,bytes32 market) payable", arguments: [{ source: "input", path: "amount.spend" }, { source: "price_bound" }, { source: "input", path: "market_id" }],
      valuePath: "amount.spend", marketPath: "market_id", when: { direction: "buy", order_type: "market", sizing: "spend" }, settlement: "atomic",
      price: { kind: "min_output", amountPath: "amount.spend", slippagePath: "slippage_bps", markets: [versionId] },
      steps: [{ target: address("8"), signature: "function configure(address account)", arguments: [{ source: "credit_account" }] }] }] });
    const client = create_termbook({ app_token: token, wallet });
    await client.ready();
    expect(client.config.use_case).toBe("spot");
    expect(chain.readContract.mock.calls.filter(([request]) => request.functionName === "isCallAllowed")).toHaveLength(2);
    chain.readContract.mockImplementation(async (request) => request.functionName === "isCallAllowed" ? false :
      request.functionName === "integrationRegistry" ? address("5") : request.functionName === "riskEngine" ? address("4") : true);
    await expect(create_termbook({ app_token: token, wallet }).ready()).rejects.toThrow("sdk-config-invalid");
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
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const nonce = `${"11".repeat(32)}.${expiresAt}`;
    const { apiAuthorizationMessage } = await import("@termbook/schema");
    const fetcher = vi.fn(async (url: string, init: { body: string }) => ({ ok: true, json: async () =>
      url.endsWith("/auth/nonce") ? { wallet: wallet.address, domain: "termbook", expiresAt, nonce,
        message: apiAuthorizationMessage("termbook", wallet.address, nonce, expiresAt, JSON.parse(init.body)) }
        : { intentId: versionId } }));
    vi.stubGlobal("fetch", fetcher);
    const client = create_termbook({ app_token: token, wallet: { ...wallet, signMessage: async () => versionId as `0x${string}` },
      core: address("2"), rpcUrl: "https://rpc.termbook.example", chainId: 143,
      apiBase: "https://api.termbook.example" });
    await client.authenticatedPost("/intents", { borrower: wallet.address });
    expect(fetcher).toHaveBeenLastCalledWith("https://api.termbook.example/intents",
      expect.objectContaining({ headers: expect.objectContaining({ "x-termbook-app-token": token,
        "x-termbook-nonce": nonce }) }));
  });

  it("rejects a server challenge that asks the wallet to sign unrelated text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ message: "unrelated" }) })));
    const signMessage = vi.fn();
    const client = create_termbook({ app_token: token, wallet: { ...wallet, signMessage },
      core: address("2"), rpcUrl: "https://rpc.termbook.example", chainId: 143,
      apiBase: "https://api.termbook.example" });
    await expect(client.authenticatedPost("/intents", { borrower: wallet.address })).rejects.toThrow("auth-challenge-invalid");
    expect(signMessage).not.toHaveBeenCalled();
  });
});
