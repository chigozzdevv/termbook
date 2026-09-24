import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, keccak256, padHex, parseAbi, stringToHex } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
import { validateIntegrationAcceptance } from "../../src/integration/integration.builder.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as const;
const word = (digit: string) => `0x${digit.repeat(64)}` as const;
const core = address("1");
const health = address("2");
const adapter = address("3");
const vault = address("4");
const token = address("5");
const healthReader = address("6");
const appReader = address("7");
const target = address("8");
const activeAccount = address("9");
const recoveredAccount = address("a");
const versionId = word("b");
const activeCreditId = word("c");
const recoveredCreditId = word("d");
const actionHash = word("e");
const recoveryHash = word("f");
const blockHash = word("a");
const recoveryTopic = keccak256(stringToHex("AppRecoveryStep(bytes32,address,address,bytes32)"));
const actions = [{ capability: "place_order", label: "Place order", target,
  signature: "function placeOrder(uint256 amount,address account)",
  arguments: [{ source: "input" as const, path: "amount", label: "Amount" },
    { source: "credit_account" as const }], settlement: "atomic" as const }];
const acceptance = { evidenceHash: word("1"), activeCreditId, recoveredCreditId,
  actionTransactions: { place_order: { creditId: recoveredCreditId, txHash: actionHash } },
  recoveryTxHashes: [recoveryHash] };
const appData = encodeFunctionData({ abi: parseAbi(["function placeOrder(uint256,address)"]),
  functionName: "placeOrder", args: [100n, recoveredAccount] });
const actionInput = encodeFunctionData({ abi: parseAbi([
  "function executeAction(bytes32,address,bytes,uint256,uint256,uint256,uint256,bytes)",
]), functionName: "executeAction", args: [recoveredCreditId, target, appData, 100n, 100n, 1n, 1000n, "0x12"] });
const previous = { core: env.core, monadChainId: env.monadChainId };

function chain(overrides: { appValue?: bigint; actionInput?: `0x${string}`; recoveryBlock?: bigint } = {}) {
  return {
    getChainId: vi.fn(async () => 143),
    getBlock: vi.fn(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 100n, timestamp: 1000n } : { hash: blockHash }),
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "healthSource") return health;
      if (functionName === "appRecoveryAdapterOfBundle") return adapter;
      if (functionName === "creditDetails") return {
        account: args?.[0] === activeCreditId ? activeAccount : recoveredAccount,
        bundleId: versionId, vault,
      };
      if (functionName === "readers") return [healthReader, 1n, true, 100n, word("1")];
      if (functionName === "asset") return token;
      if (functionName === "appReader") return appReader;
      if (functionName === "positionCount") return args?.[0] === activeCreditId ? 1n : 0n;
      if (functionName === "pendingCount") return 0n;
      if (functionName === "readAppValue") return [overrides.appValue ?? 100n, 5000, 0n, 900n];
      throw new Error(`unexpected ${functionName}`);
    }),
    getBytecode: vi.fn(async () => "0x1234"),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({
      status: "success", blockNumber: hash === actionHash ? 20n : overrides.recoveryBlock ?? 30n,
      transactionHash: hash, blockHash, to: core,
      logs: hash === recoveryHash ? [{ address: core,
        topics: [recoveryTopic, recoveredCreditId, padHex(adapter, { size: 32 }), padHex(target, { size: 32 })],
      }] : [],
    })),
    getTransaction: vi.fn(async () => ({ to: core, hash: actionHash, blockHash,
      input: overrides.actionInput ?? actionInput })),
  };
}

beforeEach(() => {
  env.core = core;
  env.monadChainId = 143;
});

afterEach(() => {
  Object.assign(env, previous);
  vi.clearAllMocks();
});

describe("integration acceptance", () => {
  it("requires finalized action and independent recovery samples", async () => {
    const client = chain();
    vi.mocked(monadClient).mockReturnValue(client as never);
    await validateIntegrationAcceptance(versionId, token, actions, acceptance);
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(2);
  });

  it("rejects a sample whose app value is zero", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ appValue: 0n }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance))
      .rejects.toThrow("integration-position-evidence-invalid");
  });

  it("rejects a recovery recorded before the sampled app action", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ recoveryBlock: 19n }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance))
      .rejects.toThrow("integration-recovery-evidence-invalid");
  });

  it("rejects a reference call to a different application selector", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ actionInput: "0x12345678" }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance))
      .rejects.toThrow("integration-action-evidence-invalid");
  });
});
