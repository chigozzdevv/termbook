import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, padHex, stringToHex, type Address, type Hex, type TransactionReceipt } from "viem";

const mocks = vi.hoisted(() => ({
  monad: { getChainId: vi.fn(), getTransactionReceipt: vi.fn(), getBlock: vi.fn(), readContract: vi.fn() },
  source: { getChainId: vi.fn(), getBlock: vi.fn(), readContract: vi.fn(), simulateContract: vi.fn() },
  proof: vi.fn(),
}));

vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(), createPublicClient: () => mocks.source,
}));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => mocks.monad }));
vi.mock("../../src/chain/monad-receipt-proof.js", async (load) => ({
  ...await load<typeof import("../../src/chain/monad-receipt-proof.js")>(),
  fetchMonadReceiptProof: mocks.proof,
}));
vi.mock("../../src/config/env.js", () => ({ env: {
  sourceRpcUrl: "http://source.test",
  monadChainId: 101, core: `0x${"1".repeat(40)}`,
} }));

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const word = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const core = address("1");
const vault = address("2");
const controller = address("3");
const borrower = address("4");
const owner = address("5");
const asset = address("6");
const creditId = word("7");
const actionHash = word("8");
const txHash = word("9");
const blockHash = word("a");
const returnTopic = keccak256(stringToHex("SourceRecoveryReturnAuthorized(bytes32,bytes32,address,uint256,uint256,uint256)"));
const authorizationTopic = keccak256(stringToHex("RemoteActionAuthorized(bytes32,bytes32,uint8)"));

function receipt(): TransactionReceipt {
  return {
    status: "success", blockHash,
    logs: [
      {
        address: core, topics: [returnTopic, creditId, actionHash, padHex(owner, { size: 32 })],
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [40n, 2n, 1_000_000n]),
      },
      {
        address: core, topics: [authorizationTopic, creditId, actionHash],
        data: encodeAbiParameters([{ type: "uint8" }], [0]),
      },
    ],
  } as TransactionReceipt;
}

function setup() {
  mocks.monad.getChainId.mockResolvedValue(101);
  mocks.monad.getTransactionReceipt.mockResolvedValue(receipt());
  mocks.monad.getBlock.mockResolvedValue({ number: 100n });
  mocks.monad.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    const values: Record<string, unknown> = {
      creditDetails: { borrower, debt: 0n, collateralAsset: asset }, collateralSourceChainOf: 1n,
      collateralOwnerOf: owner, remoteRecoveryVaultOf: vault, remoteSeizureConfirmed: true,
      sourceRecoveryReturnHash: actionHash,
    };
    return values[functionName];
  });
  mocks.source.getChainId.mockResolvedValue(1);
  mocks.source.getBlock.mockResolvedValue({ number: 12n });
  mocks.source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    const values: Record<string, unknown> = {
      asset, controller, monadChain: 101n, held: 40n, returnHeldHash: actionHash,
      monadCore: core, recoveryVault: vault,
    };
    return values[functionName];
  });
  mocks.source.simulateContract.mockResolvedValue({});
  mocks.proof.mockImplementation(async ({ selectLog }: { selectLog: (value: TransactionReceipt) => number }) => {
    expect(selectLog(receipt())).toBe(1);
    return { header: "0x1234", proof: "0x5678", blockHash };
  });
}

afterEach(() => vi.resetAllMocks());

describe("held collateral return preparation", () => {
  it("derives authorization fields from a finalized receipt and prepares a source wallet transaction", async () => {
    setup();
    const { prepareHeldReturn } = await import("../../src/recovery/return-held.service.js");
    const prepared = await prepareHeldReturn({ creditId, authorizationTxHash: txHash }, owner);
    expect(prepared.to).toBe(vault);
    expect(prepared.chainId).toBe(1);
    expect(prepared.data).toMatch(/^0x[0-9a-f]+$/);
    expect(prepared.amount).toBe("40");
    expect(mocks.source.simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      address: vault, functionName: "returnHeld",
      args: [creditId, owner, 40n, 2n, 1_000_000n, "0x1234", "0x5678"],
    }));
  });

  it("rejects an unrelated authenticated wallet", async () => {
    setup();
    const { prepareHeldReturn } = await import("../../src/recovery/return-held.service.js");
    await expect(prepareHeldReturn({ creditId, authorizationTxHash: txHash }, address("b")))
      .rejects.toThrow("return-held-core-binding-mismatch");
    expect(mocks.source.simulateContract).not.toHaveBeenCalled();
  });

  it("rejects a source vault hash mismatch before preparing calldata", async () => {
    setup();
    mocks.source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      const values: Record<string, unknown> = {
        asset, controller, monadChain: 101n, held: 40n, returnHeldHash: word("c"),
        monadCore: core, recoveryVault: vault,
      };
      return values[functionName];
    });
    const { prepareHeldReturn } = await import("../../src/recovery/return-held.service.js");
    await expect(prepareHeldReturn({ creditId, authorizationTxHash: txHash }, borrower))
      .rejects.toThrow("return-held-source-binding-mismatch");
    expect(mocks.source.simulateContract).not.toHaveBeenCalled();
  });

  it("rejects ambiguous return events for one credit", async () => {
    const { sourceRecoveryReturnEvent } = await import("../../src/recovery/return-held.service.js");
    const duplicate = receipt();
    duplicate.logs.push(duplicate.logs[0]!);
    expect(() => sourceRecoveryReturnEvent(duplicate, core, creditId))
      .toThrow("return-held-authorization-log-mismatch");
  });
});
