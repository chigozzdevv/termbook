import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ethereumConfirmationPolicy, ethereumConfirmedBlock, sepoliaConfirmationHash } from "../../src/chain/ethereum-confirmations.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
const publisher = `0x${"1".repeat(40)}` as const;
const verifier = `0x${"2".repeat(40)}` as const;
const original = env.monadChainId;
let version = 2n, depth = 5, hash = sepoliaConfirmationHash(publisher, 5);
beforeEach(() => {
  env.monadChainId = 10143; version = 2n; depth = 5; hash = sepoliaConfirmationHash(publisher, depth);
  vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 100n }), readContract: async ({ functionName }: { functionName: string }) =>
    ({ consensusVersion: version, publisher, lightClient: publisher, confirmationDepth: depth, confirmationPolicyHash: hash })[functionName] } as never);
});
afterEach(() => { env.monadChainId = original; vi.clearAllMocks(); });
it("requires the admitted chain, depth and signed policy hash", async () => {
  expect(await ethereumConfirmationPolicy(verifier)).toMatchObject({ depth: 5, consistency: 203, hash });
  hash = sepoliaConfirmationHash(publisher, 6);
  await expect(ethereumConfirmationPolicy(verifier)).rejects.toThrow("ethereum-confirmation-policy-invalid");
  depth = 4; await expect(ethereumConfirmationPolicy(verifier)).rejects.toThrow("ethereum-confirmation-policy-invalid");
  depth = 5; env.monadChainId = 999;
  await expect(ethereumConfirmationPolicy(verifier)).rejects.toThrow("ethereum-confirmation-policy-invalid");
});
it("retains full finality for the legacy verifier", async () => {
  version = 1n; env.monadChainId = 143;
  expect(await ethereumConfirmationPolicy(verifier)).toMatchObject({ depth: 0, consistency: 0 });
  version = 2n;
  expect(await ethereumConfirmationPolicy(verifier)).toMatchObject({ depth: 0, consistency: 0 });
});
it("reads the block five successors behind head and rejects mainnet", async () => {
  const getBlock = vi.fn(async (input) => input.blockTag === "latest" ? { number: 100n } : { number: input.blockNumber ?? 90n });
  const client = { getChainId: async () => 11155111, getBlock };
  expect((await ethereumConfirmedBlock(client as never, 5)).number).toBe(95n);
  expect(getBlock).toHaveBeenLastCalledWith({ blockNumber: 95n });
  expect((await ethereumConfirmedBlock(client as never, 0)).number).toBe(90n);
  await expect(ethereumConfirmedBlock({ ...client, getChainId: async () => 1 } as never, 5)).rejects.toThrow("ethereum-confirmation-policy-invalid");
});
it("requires full finality for Base Sepolia and rejects Sepolia custom confirmations", async () => {
  version = 1n;
  expect(await ethereumConfirmationPolicy(verifier, 84532)).toMatchObject({ depth: 0, consistency: 0 });
  version = 2n;
  await expect(ethereumConfirmationPolicy(verifier, 84532)).rejects.toThrow("ethereum-confirmation-policy-invalid");
  await expect(ethereumConfirmedBlock({ getChainId: async () => 84532 } as never, 5)).rejects.toThrow("ethereum-confirmation-policy-invalid");
});
