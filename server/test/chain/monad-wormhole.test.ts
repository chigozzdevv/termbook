import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";

const mocks = vi.hoisted(() => ({
  chain: { getBlock: vi.fn(), readContract: vi.fn() },
  fetch: vi.fn(),
}));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => mocks.chain }));
vi.mock("../../src/chain/wormhole-vaa.js", () => ({ fetchWormholeVaaById: mocks.fetch }));

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const word = (digit: string) => `0x${digit.repeat(64)}` as Hex;

afterEach(() => vi.resetAllMocks());

describe("Monad Wormhole message lookup", () => {
  it("binds the current Core sequence to the credit action digest", async () => {
    const { currentEthereumAuthorization } = await import("../../src/chain/monad-wormhole.js");
    const core = address("1");
    const creditId = word("2");
    const actionHash = word("3");
    mocks.chain.getBlock.mockResolvedValue({ number: 50n });
    mocks.chain.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "ethereumAuthorizationPublished" ? true : 7n);
    mocks.fetch.mockResolvedValue({ header: "0x1234", proof: "0x" });
    await currentEthereumAuthorization({ core, creditId, actionHash, kind: 1 });
    const digest = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }],
      [creditId, actionHash, 1],
    ));
    expect(mocks.fetch).toHaveBeenCalledWith({
      chain: 48, emitter: core, sequence: 7n,
      payload: encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [keccak256(stringToHex("Termbook Wormhole authorization v1")), digest],
      ),
    });
  });

  it("rejects an operation with no published VAA", async () => {
    const { currentEthereumRecoveryOperation } = await import("../../src/chain/monad-wormhole.js");
    mocks.chain.getBlock.mockResolvedValue({ number: 50n });
    mocks.chain.readContract.mockResolvedValue(false);
    await expect(currentEthereumRecoveryOperation({
      factory: address("1"), operationId: word("2"), digest: word("3"), inbox: address("4"),
    })).rejects.toThrow("monad-wormhole-message-unpublished");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
