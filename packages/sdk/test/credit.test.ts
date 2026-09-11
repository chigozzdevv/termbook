import { describe, expect, it } from "vitest";
import { CreditApp } from "../src/app/app.js";

describe("app", () => {
  it("rejects unknown capability", async () => {
    const app = new CreditApp({} as never, "0x0000000000000000000000000000000000000000");
    await expect(app.execute({ capability: "hack", params: {} })).rejects.toThrow();
  });
});
