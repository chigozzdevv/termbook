import { sampleSuite } from "./suite.fixture.js";
import { suiteHash } from "../../src/integration/integration.suite.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, keccak256, padHex, parseAbi, stringToHex } from "viem";

vi.mock("../../src/integration/integration.suite.js", async (original) => ({ ...await original<typeof import("../../src/integration/integration.suite.js")>(), validateIntegrationSuite: vi.fn(async (_chain, _version, _hash, suite) => suite) }));

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
const repaymentHash = word("1");
const blockHash = word("a");
const recoveryTopic = keccak256(stringToHex("AppRecoveryStep(bytes32,address,address,bytes32)"));
const repaidTopic = keccak256(stringToHex("Repaid(bytes32,uint256,uint256)"));
const actions = [{ capability: "place_order", label: "Place order", target,
  signature: "function placeOrder(uint256 amount,address account)",
  arguments: [{ source: "input" as const, path: "amount", label: "Amount" },
    { source: "credit_account" as const }], settlement: "atomic" as const }];
const suite = sampleSuite({ core, versionId });
const acceptance = { suite, evidenceHash: suiteHash(suite), activeCreditId, recoveredCreditId,
  actionTransactions: { place_order: { creditId: recoveredCreditId, txHash: actionHash } },
  recoveryTxHashes: [recoveryHash], repaymentTxHash: repaymentHash };
const appData = encodeFunctionData({ abi: parseAbi(["function placeOrder(uint256,address)"]),
  functionName: "placeOrder", args: [100n, recoveredAccount] });
const actionInput = encodeFunctionData({ abi: parseAbi([
  "function executeAction(bytes32,address,bytes,uint256,uint256,uint256,uint256,bytes)",
]), functionName: "executeAction", args: [recoveredCreditId, target, appData, 100n, 100n, 1n, 1000n, "0x12"] });
const repaymentInput = encodeFunctionData({ abi: parseAbi(["function recoverAccountCash(bytes32,uint256)"]),
  functionName: "recoverAccountCash", args: [recoveredCreditId, 60n] });
const previous = { core: env.core, monadChainId: env.monadChainId };

function chain(overrides: { appValue?: bigint; actionInput?: `0x${string}`; recoveryBlock?: bigint;
  repaymentInput?: `0x${string}`; repaymentBlock?: bigint; recoverySender?: string } = {}) {
  return {
    getChainId: vi.fn(async () => 143),
    getBlock: vi.fn(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 100n, timestamp: 1000n } : { hash: blockHash }),
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "retentionSupported") return false;
      if (functionName === "recoveryKeepers") return true;
      if (functionName === "healthSource") return health;
      if (functionName === "appRecoveryAdapterOfBundle") return adapter;
      if (functionName === "creditDetails") return {
        account: args?.[0] === activeCreditId ? activeAccount : recoveredAccount,
        bundleId: versionId, vault, borrower: suite.actors.borrower,
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
      status: "success", blockNumber: hash === actionHash ? 20n
        : hash === recoveryHash ? overrides.recoveryBlock ?? 30n : overrides.repaymentBlock ?? 40n,
      transactionIndex: 0, transactionHash: hash, blockHash, to: core,
      logs: hash === recoveryHash ? [{ address: core,
        topics: [recoveryTopic, recoveredCreditId, padHex(adapter, { size: 32 }), padHex(target, { size: 32 })],
      }] : hash === repaymentHash ? [{ address: core,
        topics: [repaidTopic, recoveredCreditId],
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [60n, 40n]),
      }] : [],
    })),
    getTransaction: vi.fn(async ({ hash }: { hash: string }) => ({ to: core, hash, blockHash, from: overrides.recoverySender ?? suite.actors.keeper,
      input: hash === repaymentHash ? overrides.repaymentInput ?? repaymentInput : overrides.actionInput ?? actionInput })),
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
    await validateIntegrationAcceptance(versionId, token, actions, acceptance, suite.manifestHash as `0x${string}`);
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(3);
  });
  it("requires execution-plan evidence for a distinct route key", async () => {
    vi.mocked(monadClient).mockReturnValue(chain() as never);
    const route = { ...actions[0]!, executionKey: "buy_market" };
    const evidence = { ...acceptance, actionTransactions: { buy_market: acceptance.actionTransactions.place_order! } };
    await expect(validateIntegrationAcceptance(versionId, token, [route], evidence, suite.manifestHash as `0x${string}`))
      .rejects.toThrow("integration-action-evidence-invalid");
  });

  it("rejects a recovery performed by the borrower", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ recoverySender: suite.actors.borrower }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance, suite.manifestHash as `0x${string}`))
      .rejects.toThrow("integration-recovery-evidence-invalid");
  });

  it("rejects a sample whose app value is zero", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ appValue: 0n }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance, suite.manifestHash as `0x${string}`))
      .rejects.toThrow("integration-position-evidence-invalid");
  });

  it("rejects a recovery recorded before the sampled app action", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ recoveryBlock: 19n }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance, suite.manifestHash as `0x${string}`))
      .rejects.toThrow("integration-recovery-evidence-invalid");
  });

  it("rejects a reference call to a different application selector", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ actionInput: "0x12345678" }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance, suite.manifestHash as `0x${string}`))
      .rejects.toThrow("integration-action-evidence-invalid");
  });

  it("rejects repayment before the forced recovery action", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ repaymentBlock: 29n }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance, suite.manifestHash as `0x${string}`))
      .rejects.toThrow("integration-repayment-evidence-invalid");
  });

  it("rejects a repayment that was not made from the recovered account", async () => {
    const input = encodeFunctionData({ abi: parseAbi(["function repay(bytes32,uint256)"]),
      functionName: "repay", args: [recoveredCreditId, 60n] });
    vi.mocked(monadClient).mockReturnValue(chain({ repaymentInput: input }) as never);
    await expect(validateIntegrationAcceptance(versionId, token, actions, acceptance, suite.manifestHash as `0x${string}`))
      .rejects.toThrow("integration-repayment-evidence-invalid");
  });
});
