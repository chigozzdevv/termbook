import { describe, expect, it, vi } from "vitest";
import { recoveryService } from "../../src/recovery/recovery.service.js";
import { recoveryRepo } from "../../src/recovery/recovery.repo.js";

describe("recovery admission", () => {
  it("rejects unsupported recovery plans before storing them", async () => {
    const open = vi.spyOn(recoveryRepo, "open");
    try {
      await expect(recoveryService.open({ creditId: "0x1234" })).rejects.toMatchObject({
        status: 503,
        message: "recovery-route-unavailable",
      });
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });
});
