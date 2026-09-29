import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

vi.mock("../../src/auth/auth.repo.js", () => ({ authRepo: { consume: vi.fn() } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { authRepo } from "../../src/auth/auth.repo.js";
import { authService } from "../../src/auth/auth.service.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
import { apiAuthorizationMessage } from "@termbook/schema";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const contractWallet = `0x${"22".repeat(20)}`;
let nonce: string;
const request = { method: "POST" as const, path: "/intents", bodyHash: `0x${"33".repeat(32)}` };
let expiresAt: number;
const message = (wallet: string) => apiAuthorizationMessage(env.authDomain, wallet, nonce, expiresAt, request);

beforeEach(() => {
  vi.clearAllMocks();
  expiresAt = Math.floor(Date.now() / 1000) + 60;
  nonce = `${"77".repeat(32)}.${expiresAt}`;
  vi.mocked(authRepo.consume).mockResolvedValue(true);
});

describe("wallet authentication", () => {
  it("accepts an EOA signature and consumes its nonce", async () => {
    const signature = await account.signMessage({ message: message(account.address) });
    await expect(authService.authenticate(account.address, signature, nonce, request))
      .resolves.toMatchObject({ wallet: account.address.toLowerCase(), nonce });
    expect(authRepo.consume).toHaveBeenCalledOnce();
    expect(monadClient).not.toHaveBeenCalled();
  });

  it("accepts an ERC-1271 contract signature at a finalized block", async () => {
    const chain = { getBlock: vi.fn(async () => ({ number: 42n })),
      getBytecode: vi.fn(async () => "0x1234"),
      readContract: vi.fn(async () => "0x1626ba7e") };
    vi.mocked(monadClient).mockReturnValue(chain as never);
    await expect(authService.authenticate(contractWallet, "0x1234", nonce, request))
      .resolves.toMatchObject({ wallet: contractWallet, nonce });
    expect(chain.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: contractWallet, functionName: "isValidSignature", blockNumber: 42n,
    }));
  });

  it("rejects a contract response without the ERC-1271 magic value", async () => {
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 42n }),
      getBytecode: async () => "0x1234", readContract: async () => "0xffffffff" } as never);
    await expect(authService.authenticate(contractWallet, "0x1234", nonce, request)).rejects.toThrow("auth-invalid");
    expect(authRepo.consume).not.toHaveBeenCalled();
  });

  it("rejects a signed request used for a different endpoint or payload", async () => {
    const signature = await account.signMessage({ message: message(account.address) });
    await expect(authService.authenticate(account.address, signature, nonce,
      { ...request, path: "/integrations" })).rejects.toThrow("auth-invalid");
    await expect(authService.authenticate(account.address, signature, nonce,
      { ...request, bodyHash: `0x${"44".repeat(32)}` })).rejects.toThrow("auth-invalid");
    expect(authRepo.consume).not.toHaveBeenCalled();
  });

  it("keeps a signed challenge valid when an unrelated caller issues more challenges", async () => {
    const signature = await account.signMessage({ message: message(account.address) });
    for (let index = 0; index < 20; index += 1) await authService.nonce(account.address, request);
    await authService.authenticate(account.address, signature, nonce, request);
    expect(authRepo.consume).toHaveBeenCalledWith(account.address.toLowerCase(), nonce, expiresAt);
  });

  it("rejects concurrent consumption or replay of a challenge", async () => {
    vi.mocked(authRepo.consume).mockResolvedValue(false);
    const signature = await account.signMessage({ message: message(account.address) });
    await expect(authService.authenticate(account.address, signature, nonce, request)).rejects.toThrow("auth-expired");
  });
});
