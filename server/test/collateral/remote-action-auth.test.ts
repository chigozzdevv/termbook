import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
import { hashRemoteAction, readAuthorizedAction, type RemoteAction } from "../../src/collateral/remote-action.js";

const creditId = `0x${"11".repeat(32)}` as const;
const borrower = `0x${"22".repeat(20)}` as const;
const core = `0x${"33".repeat(20)}` as const;
const sourceVault = `0x${"44".repeat(20)}` as const;
const asset = `0x${"55".repeat(20)}` as const;
const lockId = `0x${"66".repeat(32)}` as const;
const recoveryVault = `0x${"77".repeat(20)}` as const;

beforeEach(() => {
  env.core = core;
  env.monadChainId = 10143;
});

describe("finalized remote return authorization", () => {
  it("uses Core's bounded return deadline in the source action hash", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
    const action: RemoteAction = {
      monadChain: 10143n, monadCore: core, sourceChain: 1n, sourceVault,
      creditId, lockId, asset, kind: 0, recipient: borrower,
      amount: 100n, nonce: 1n, deadline,
    };
    const hash = hashRemoteAction(action);
    vi.mocked(monadClient).mockReturnValue({
      getChainId: vi.fn().mockResolvedValue(10143),
      getBlock: vi.fn().mockResolvedValue({ number: 100n }),
      readContract: vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) => ({
        creditDetails: { borrower, lockId, collateralVault: sourceVault, collateralAsset: asset,
          collateralAmount: 100n, returnRecipient: borrower },
        collateralSourceChainOf: 1n, remoteCollateral: true, solanaCollateral: false,
        remoteActionNonce: 1n, pendingRemoteReturn: 100n,
        remoteReturnActionHash: hash, remoteReturnDeadline: deadline,
        remoteRecoveryVaultOf: recoveryVault,
      })[functionName]),
    } as never);

    const result = await readAuthorizedAction(creditId, 0, borrower);
    expect(result.action.deadline).toBe(deadline);
    expect(result.actionHash).toBe(hash);
  });
});
