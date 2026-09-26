import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

vi.mock("../../src/auth/auth.repo.js", () => ({ authRepo: { get: vi.fn(), consume: vi.fn() } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { authRepo } from "../../src/auth/auth.repo.js";
import { authService } from "../../src/auth/auth.service.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const contractWallet = `0x${"22".repeat(20)}`;
const nonce = 7;
const message = (wallet: string) => `Termbook login ${env.authDomain} ${wallet.toLowerCase()} ${nonce}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authRepo.get).mockResolvedValue({ nonce,
    expiresAt: Math.floor(Date.now() / 1000) + 60 } as never);
  vi.mocked(authRepo.consume).mockResolvedValue({ wallet: account.address } as never);
});

describe("wallet authentication", () => {
  it("accepts an EOA signature and consumes its nonce", async () => {
    const signature = await account.signMessage({ message: message(account.address) });
    await expect(authService.authenticate(account.address, signature))
      .resolves.toMatchObject({ wallet: account.address.toLowerCase(), nonce });
    expect(authRepo.consume).toHaveBeenCalledOnce();
    expect(monadClient).not.toHaveBeenCalled();
  });

  it("accepts an ERC-1271 contract signature at a finalized block", async () => {
    const chain = { getBlock: vi.fn(async () => ({ number: 42n })),
      getBytecode: vi.fn(async () => "0x1234"),
      readContract: vi.fn(async () => "0x1626ba7e") };
    vi.mocked(monadClient).mockReturnValue(chain as never);
    await expect(authService.authenticate(contractWallet, "0x1234"))
      .resolves.toMatchObject({ wallet: contractWallet, nonce });
    expect(chain.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: contractWallet, functionName: "isValidSignature", blockNumber: 42n,
    }));
  });

  it("rejects a contract response without the ERC-1271 magic value", async () => {
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 42n }),
      getBytecode: async () => "0x1234", readContract: async () => "0xffffffff" } as never);
    await expect(authService.authenticate(contractWallet, "0x1234")).rejects.toThrow("auth-invalid");
    expect(authRepo.consume).not.toHaveBeenCalled();
  });
});
