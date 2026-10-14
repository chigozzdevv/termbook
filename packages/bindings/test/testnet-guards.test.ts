import { afterEach, describe, expect, it, vi } from "vitest";
import { reuseGuard } from "../../../scripts/testnet/guards.mjs";
import { viem } from "../../../scripts/testnet/runtime.mjs";
const { keccak256 } = viem;

const address = "0xguard", dependency = "0xtoken", implementation = "0ximplementation", getter = "0x12345678";
function fixture(overrides = {}) {
  const record = { contractPins: { Guard: { address, codeHash: keccak256("0x1234") } } };
  const read = vi.fn(async (_contract: string, _address: string, method: string) => ({
    proxy: dependency, implementation, getter, valid: true, libraryCount: 1n, libraryAt: "0xlibrary", ...overrides,
  })[method as "proxy"]);
  const network = { client: { getCode: vi.fn(async () => "0x1234") }, read };
  const runtime = { deployment: { configuration: { setup: record, app: record } }, report: { addresses: {} }, persist: vi.fn() };
  return { network, runtime };
}
afterEach(() => vi.restoreAllMocks());
describe("testnet guard reuse", () => {
  it("returns no guard for a fresh setup", async () => {
    const { network, runtime } = fixture();
    runtime.deployment.configuration = {} as typeof runtime.deployment.configuration;
    await expect(reuseGuard(runtime, network, "setup", "Guard", "ImplementationGuard", dependency, implementation, getter)).resolves.toBeNull();
    expect(network.client.getCode).not.toHaveBeenCalled();
  });
  it("reuses a code-pinned guard with unchanged bindings", async () => {
    const { network, runtime } = fixture();
    await expect(reuseGuard(runtime, network, "setup", "Guard", "ImplementationGuard", dependency, implementation, getter)).resolves.toBe(address);
    expect(runtime.report.addresses).toEqual({ Guard: address });
  });
  it.each([{ proxy: "changed" }, { implementation: "changed" }, { getter: "changed" }, { valid: false }])("rejects changed dependencies", async (override) => {
    const { network, runtime } = fixture(override);
    await expect(reuseGuard(runtime, network, "setup", "Guard", "ImplementationGuard", dependency, implementation, getter)).rejects.toThrow();
  });
  it("rejects changed guard code and unexpected linked libraries", async () => {
    const { network, runtime } = fixture();
    network.client.getCode.mockResolvedValueOnce("0x4567");
    await expect(reuseGuard(runtime, network, "app", "Guard", "LinkedLibraryGuard", dependency, implementation, getter)).rejects.toThrow("code changed");
    await expect(reuseGuard(runtime, network, "app", "Guard", "LinkedLibraryGuard", dependency, implementation, getter, ["unexpected"])).rejects.toThrow("libraries changed");
  });
});
