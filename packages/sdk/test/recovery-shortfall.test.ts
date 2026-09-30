import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, padHex, stringToHex } from "viem";
import { House } from "../src/house/house.js";
import type { TermbookClient } from "../src/client/client.js";
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const operationId = `0x${"a".repeat(64)}` as `0x${string}`,
  creditId = `0x${"b".repeat(64)}` as `0x${string}`;
const houseId = address("1"),
  core = address("2"),
  factory = address("3"),
  inbox = address("4"),
  token = address("5"),
  manager = address("6");
let values: Record<string, unknown>;
function fixture() {
  const write = vi.fn(async () => operationId);
  const client = {
    ready: vi.fn(),
    config: { chainId: 143, core },
    signer: { address: () => manager },
    rpc: {
      client: {
        getChainId: async () => 143,
        getBlock: async () => ({ number: 10n, hash: creditId, timestamp: 5000n }),
      },
      read: vi.fn(
        async (
          _address: string,
          _abi: unknown,
          name: string,
          _args?: readonly unknown[],
          _blockNumber?: bigint,
        ) => values[name],
      ),
      write,
      wait: vi.fn(async () => ({
        logs: [
          {
            address: factory,
            topics: [
              keccak256(stringToHex("RecoveryShortfallAccepted(bytes32,bytes32,uint256,uint256)")),
              operationId,
              creditId,
            ],
            data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [200n, 200n]),
            transactionHash: operationId,
            blockHash: creditId,
            blockNumber: 10n,
            logIndex: 0,
            transactionIndex: 0,
            removed: false,
          },
        ],
      })),
    },
  };
  return { house: new House(client as unknown as TermbookClient, houseId), client, write };
}
beforeEach(() => {
  values = {
    inboxFactory: factory,
    core,
    asset: token,
    manager,
    inboxOf: inbox,
    recoveryOperation: true,
    recoverySettled: false,
    recoveryCancelled: false,
    acceptedRecoveryShortfall: 0n,
    RECOVERY_SHORTFALL_DELAY: 3600n,
    vault: houseId,
    token,
    creditId,
    deadline: 1000n,
    minOut: 400n,
    applied: 200n,
    refunded: 0n,
    untrackedApplied: 0n,
    untrackedRefunded: 0n,
    available: 0n,
    balanceOf: 0n,
    creditVault: houseId,
    creditDebt: 300n,
  };
});
describe("House recovery shortfall review", () => {
  it("reads a consistent finalized snapshot and exposes unchanged debt", async () => {
    const { house, client } = fixture();
    expect(await house.recovery_operation(operationId)).toMatchObject({
      accounted: 200n,
      shortfall: 200n,
      debt: 300n,
      canAcceptShortfall: true,
    });
    expect(client.rpc.read.mock.calls.every((call) => call[4] === 10n)).toBe(true);
  });
  it("requires the reviewed allocation and actual House manager", async () => {
    const { house, write } = fixture();
    await expect(
      house.accept_recovery_shortfall({ operation_id: operationId, expected_accounted: 199n }),
    ).rejects.toThrow("recovery-shortfall-review-changed");
    values.manager = padHex("0x01", { size: 20 });
    await expect(
      house.accept_recovery_shortfall({ operation_id: operationId, expected_accounted: 200n }),
    ).rejects.toThrow("recovery-house-manager-required");
    expect(write).not.toHaveBeenCalled();
  });
  it("keeps unallocated custody and cross-House operations out of the acceptance path", async () => {
    const { house, write } = fixture();
    values.balanceOf = 1n;
    await expect(
      house.accept_recovery_shortfall({ operation_id: operationId, expected_accounted: 200n }),
    ).rejects.toThrow("recovery-shortfall-review-changed");
    values.balanceOf = 0n;
    values.creditVault = address("7");
    await expect(house.recovery_operation(operationId)).rejects.toThrow("recovery-house-mismatch");
    expect(write).not.toHaveBeenCalled();
  });
  it("checks the allocation and shortfall event from the registered factory", async () => {
    const { house, write } = fixture();
    await expect(
      house.accept_recovery_shortfall({ operation_id: operationId, expected_accounted: 200n }),
    ).resolves.toEqual({ tx: operationId, accounted: 200n, shortfall: 200n });
    expect(write).toHaveBeenCalledWith(houseId, expect.anything(), "acceptRecoveryShortfall", [
      operationId,
      200n,
    ]);
  });
});
