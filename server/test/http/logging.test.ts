import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/logging/logger.js";

afterEach(() => vi.restoreAllMocks());
describe("operational logging", () => {
  it("omits credentials, signed transaction bodies, and nested RPC error dumps", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = Object.assign(new Error("raw transaction secret"), { rawTransaction: "signed-secret", abi: Array(500).fill("ABI") });
    logger.error("keeper-failed", { error: cause, privateKey: "private-secret", raw: "raw-secret", hash: "public-hash" });
    const result = write.mock.calls[0]?.[0] as string;
    expect(result).not.toContain("secret");
    expect(result).not.toContain("ABI");
    expect(JSON.parse(result)).toEqual({ level: "error", msg: "keeper-failed", extra: {
      error: { name: "Error" }, privateKey: "[redacted]", raw: "[redacted]", hash: "public-hash",
    } });
  });
});
