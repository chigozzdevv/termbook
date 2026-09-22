import { describe, expect, it, vi } from "vitest";
import { settlementService } from "../../src/settlement/settlement.service.js";
import { settlementRepo } from "../../src/settlement/settlement.repo.js";

describe("settlement admission", () => {
  it("rejects unsupported routes before creating an operation", async () => {
    const save = vi.spyOn(settlementRepo, "save");
    try {
      await expect(settlementService.register({ operationId: "0x1234" })).rejects.toMatchObject({
        status: 503,
        message: "settlement-route-unavailable",
      });
      expect(save).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
    }
  });
});
