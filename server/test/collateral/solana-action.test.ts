import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { solanaAlias } from "../../src/quote/solana.js";

vi.mock("../../src/collateral/remote-action.service.js", () => ({ verifyAuthorizationReceipt: vi.fn() }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/collateral/solana-proof.js", () => ({
  fetchSolanaProof: vi.fn(), solanaFinalizedClock: vi.fn(),
}));

import { monadClient } from "../../src/chain/monad.client.js";
import { fetchSolanaProof, solanaFinalizedClock } from "../../src/collateral/solana-proof.js";
import { hashSolanaAction, solanaActionService, type SolanaAction } from "../../src/collateral/solana-action.service.js";
import { env } from "../../src/config/env.js";

const word = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const creditId = word("1");
const lockId = word("2");
const genesis = word("3");
const programId = word("4");
const pda = word("5");
const returnRecipient = word("6");
const recoveryVault = word("7");
const programDataHash = word("8");
const sourceTx = "2".repeat(88);
const borrower = address("9");
const core = address("a");
const verifier = address("b");
const code = "0x1234" as const;
const codeHash = keccak256(code);
const originalEnv = { core: env.core, monadChainId: env.monadChainId };
const originalSolanaRpc = process.env["SOLANA_RPC_URL"];
const originalSolanaProof = process.env["SOLANA_PROOF_URL"];

beforeEach(() => {
  env.core = core;
  env.monadChainId = 143;
  process.env["SOLANA_RPC_URL"] = "https://solana.example";
  process.env["SOLANA_PROOF_URL"] = "https://solana-proof.example";
  vi.mocked(solanaFinalizedClock).mockResolvedValue(100);
  vi.mocked(fetchSolanaProof).mockResolvedValue({ header: "0xcc", proof: "0xdd", slot: 80,
    blockhash: "So11111111111111111111111111111111111111112" });
});

afterEach(() => {
  Object.assign(env, originalEnv);
  if (originalSolanaRpc === undefined) delete process.env["SOLANA_RPC_URL"];
  else process.env["SOLANA_RPC_URL"] = originalSolanaRpc;
  if (originalSolanaProof === undefined) delete process.env["SOLANA_PROOF_URL"];
  else process.env["SOLANA_PROOF_URL"] = originalSolanaProof;
  vi.clearAllMocks();
});

function source(kind: 0 | 1 | 2, verified = true) {
  const amount = 500_000_000n;
  const action: SolanaAction = {
    monadChain: 143n, monadCore: core, sourceGenesis: genesis, sourceVault: pda,
    creditId, lockId, asset: NATIVE_SOL_ASSET_BYTES, kind,
    recipient: kind === 2 ? word("c") : kind === 0 ? returnRecipient : recoveryVault,
    amountLamports: amount, nonce: 2n, revision: 3n, deadline: 500n,
    verifierVersion: 1n,
  };
  const actionHash = hashSolanaAction(action, programId);
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => ({
    creditDetails: { revision: 9n, borrower, lockId, collateralVault: solanaAlias(genesis, programId),
      collateralAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES),
      returnRecipient: solanaAlias(genesis, returnRecipient), verifierVersion: 1n, verifierCodeHash: codeHash },
    solanaCollateral: true, collateralSourceChainOf: 1001n,
    solanaIdentityOf: [genesis, programId, NATIVE_SOL_ASSET_BYTES, word("c"),
      returnRecipient, recoveryVault, 1n],
    solanaLockPdaOf: pda, remoteActionNonce: 2n,
    pendingCollateralTopUp: kind === 2 ? [amount, actionHash, 3n, 500n] : [0n, word("0"), 0n, 0n],
    pendingRemoteReturn: kind === 0 ? amount : 0n,
    pendingRemoteSeizure: kind === 1 ? amount : 0n,
    remoteReturnActionHash: kind === 0 ? actionHash : word("0"),
    remoteSeizureActionHash: kind === 1 ? actionHash : word("0"),
    remoteReturnRevision: 3n, remoteSeizureRevision: 3n,
    remoteReturnDeadline: 500n, remoteSeizureDeadline: 500n,
    recoveryKeepers: true, remoteSeizureRecipient: solanaAlias(genesis, recoveryVault),
    solanaMarkets: [genesis, programId, programDataHash, NATIVE_SOL_ASSET_BYTES, false],
    solanaActionHash: actionHash, verifierRegistry: address("d"),
    verifiers: [verifier, 1n, true, 0n, codeHash],
    verifySolanaAction: verified, verifySolanaCancellation: verified,
  })[functionName]);
  const call = vi.fn(async () => ({ data: "0x" }));
  vi.mocked(monadClient).mockReturnValue({
    getChainId: async () => 143,
    getBlock: async () => ({ number: 100n }),
    readContract, getCode: async () => code, call,
  } as never);
  return { actionHash, readContract, call };
}

describe("Solana remote action plans", () => {
  it("uses the authorization revision saved by Core even after the credit revision advances", async () => {
    const { actionHash } = source(0);
    const result = await solanaActionService.plan({ creditId, kind: "release", mode: "apply",
      authorizationTxHash: word("e") }, borrower);
    expect(result.action.revision).toBe("3");
    expect(result.actionHash).toBe(actionHash);
    expect(result.authorizationTxHash).toBe(word("e"));
  });

  it("binds top-up funding to the existing source owner and exact amount", async () => {
    const { actionHash } = source(2);
    const result = await solanaActionService.plan({ creditId, kind: "topup", mode: "apply", authorizationTxHash: word("e") }, borrower);
    expect(result.action.kind).toBe(2);
    expect(result.action.recipient).toBe(word("c"));
    expect(result.action.amountLamports).toBe("500000000");
    expect(result.actionHash).toBe(actionHash);
    expect(result.programDataHash).toBe(programDataHash);
  });
  it("confirms a top-up through the pinned action verifier", async () => {
    const { actionHash } = source(2);
    const result = await solanaActionService.confirmationPlan({ creditId, kind: "topup", mode: "apply", sourceTx }, borrower);
    expect(result).toMatchObject({ to: core, mode: "apply", actionHash });
    expect(result.data.slice(0, 10)).toBe((await import("viem")).toFunctionSelector("confirmCollateralTopUp(bytes32,bytes,bytes)"));
  });
  it("returns a Monad confirmation only after the pinned verifier accepts the finalized source proof", async () => {
    const { actionHash, call } = source(1);
    const result = await solanaActionService.confirmationPlan({ creditId, kind: "seize", mode: "apply", sourceTx }, borrower);
    expect(result).toMatchObject({ to: core, actionHash, sourceSlot: 80, mode: "apply" });
    expect(fetchSolanaProof).toHaveBeenCalledWith(expect.objectContaining({
      kind: "action", sourceTx, digest: actionHash, programDataHash, lockPda: pda,
    }));
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ to: core, data: result.data }));
  });

  it("rejects an unverified cancellation before preparing a Monad transaction", async () => {
    const { call } = source(0, false);
    await expect(solanaActionService.confirmationPlan({ creditId, kind: "release", mode: "expire", sourceTx }, borrower))
      .rejects.toThrow("solana-action-proof-rejected");
    expect(call).not.toHaveBeenCalled();
  });
});
