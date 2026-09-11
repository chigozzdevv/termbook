import { describe, expect, it } from "vitest";
import { CreditAccount } from "../src/account/account.js";

describe("account", () => {
  it("rejects invalid withdrawals before calling the wallet", async () => {
    const account = new CreditAccount({} as never, "0x0000000000000000000000000000000000000000000000000000000000000001");
    await expect(account.withdraw({ asset: "0x0000000000000000000000000000000000000000", amount: 0n })).rejects.toThrow("param-invalid");
  });
});
