import { describe, expect, it, vi } from "vitest";
import { collateralVaultAbi, nativeCollateralVaultAbi } from "@termbook/bindings";
import type { TermbookClient } from "../src/client/client.js";
import { CreditCollateral } from "../src/collateral/collateral.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;

const creditId = hash("1");
const vault = address("2");
const asset = address("3");
const owner = address("4");

function fixture(kind: boolean | "unknown") {
  const identityRead = vi.fn(async ({ blockTag }: { blockTag?: string }) => {
    if (blockTag !== "finalized" || kind === "unknown") throw new Error("identity-unavailable");
    return kind;
  });
  const approve = vi.fn(async () => hash("5"));
  const write = vi.fn(async () => hash("6"));
  const coreWrite = vi.fn(async () => hash("7"));
  const client = {
    ready: async () => {},
    config: { chainId: 143, collateralVault: vault },
    signer: { address: () => owner },
    rpc: {
      client: { readContract: identityRead },
      creditDetails: async () => ({ collateralVault: vault, collateralAsset: asset, collateralAmount: 0n }),
      read: async (_address: string, _abi: unknown, functionName: string) => functionName === "chainId_" ? 143n : asset,
      approve,
      facility: async () => 1,
      revision: async () => 2n,
      write,
      coreWrite,
      wait: async () => ({ status: "success" }),
    },
  } as unknown as TermbookClient;
  return { collateral: new CreditCollateral(client, creditId), identityRead, approve, write, coreWrite };
}

describe("credit collateral", () => {
  it("pays native MON to the native vault without ERC-20 approval", async () => {
    const { collateral, identityRead, approve, write, coreWrite } = fixture(true);
    const result = await collateral.add({ amount: 10n });
    expect(identityRead).toHaveBeenCalledWith(expect.objectContaining({ address: vault, functionName: "isNativeCollateralVault", blockTag: "finalized" }));
    expect(approve).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      vault, nativeCollateralVaultAbi, "lockNativeWithDeadline",
      [result.lockId, creditId, owner, 10n, owner, expect.any(BigInt), 2n], 10n,
    );
    expect(coreWrite).toHaveBeenCalledWith("bindCollateral", [creditId, result.lockId]);
  });

  it("keeps ERC-20 approval and lock for a token vault", async () => {
    const { collateral, approve, write } = fixture(false);
    const result = await collateral.add({ amount: 10n });
    expect(approve).toHaveBeenCalledWith(asset, vault, 10n);
    expect(write).toHaveBeenCalledWith(
      vault, collateralVaultAbi, "lockWithDeadline",
      [result.lockId, creditId, owner, 10n, owner, expect.any(BigInt), 2n],
    );
  });

  it("does not approve or lock when the vault kind is unverified", async () => {
    const { collateral, approve, write, coreWrite } = fixture("unknown");
    await expect(collateral.add({ amount: 10n })).rejects.toThrow("collateral-vault-kind-unverified");
    expect(approve).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(coreWrite).not.toHaveBeenCalled();
  });
});
