import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { monadClient } from "../../src/chain/monad.client.js";
import { verifyHouseSignature } from "../../src/quote/signature.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

const digest = `0x${"a".repeat(64)}` as `0x${string}`;
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);

beforeEach(() => vi.clearAllMocks());

describe("House quote signatures", () => {
  it("accepts both EOA signature forms supported by Core", async () => {
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 10n }),
      getBytecode: async () => "0x" } as never);
    const raw = await account.sign({ hash: digest });
    const personal = await account.signMessage({ message: { raw: digest } });
    expect(await verifyHouseSignature(account.address, digest, raw)).toBe(true);
    expect(await verifyHouseSignature(account.address, digest, personal)).toBe(true);
  });

  it("checks ERC-1271 signatures at the finalized block", async () => {
    const house = `0x${"2".repeat(40)}` as `0x${string}`;
    const signature = "0x1234" as `0x${string}`;
    const readContract = vi.fn(async () => "0x1626ba7e");
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 11n }),
      getBytecode: async () => "0x6000", readContract } as never);
    expect(await verifyHouseSignature(house, digest, signature)).toBe(true);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: house, functionName: "isValidSignature", args: [digest, signature], blockNumber: 11n,
    }));
  });
});
