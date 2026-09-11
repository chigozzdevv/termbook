import { describe, expect, it } from "vitest";
import { House } from "../src/house/house.js";

describe("house", () => {
  it("rejects invalid vault addresses", () => {
    expect(() => new House({} as never, "0x0" as never)).toThrow("param-invalid");
  });
});
