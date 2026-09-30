import { describe, expect, it, vi } from "vitest";
import { CreditAccount } from "../src/account/account.js";

describe("account", () => {
  it("rejects invalid withdrawals before calling the wallet", async () => {
    const account = new CreditAccount({} as never, "0x0000000000000000000000000000000000000000000000000000000000000001");
    await expect(account.withdraw({ asset: "0x0000000000000000000000000000000000000000", amount: 0n })).rejects.toThrow("param-invalid");
  });

  it("uses borrower account control after closure instead of Core withdrawal", async () => {
    const address = `0x${"1".repeat(40)}` as const;
    const write = vi.fn().mockResolvedValue(`0x${"2".repeat(64)}`);
    const coreWrite = vi.fn();
    const account = new CreditAccount({ ready: async () => {}, signer: { address: () => address },
      rpc: { account: async () => address, read: async () => true, write, coreWrite, wait: async () => {} },
    } as never, `0x${"3".repeat(64)}`);
    await account.withdraw({ asset: address, amount: 10n });
    expect(write).toHaveBeenCalledWith(address, expect.anything(), "transferToken", [address, address, 10n]);
    expect(coreWrite).not.toHaveBeenCalled();
  });

  it("checks the completed control transfer before reporting a liquidated account released", async () => {
    const address = `0x${"1".repeat(40)}` as const;
    const read = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const account = new CreditAccount({ ready: async () => {}, rpc: { account: async () => address,
      read, coreWrite: async () => `0x${"2".repeat(64)}`, wait: async () => {},
    } } as never, `0x${"3".repeat(64)}`);
    await expect(account.release()).rejects.toThrow("account-release-pending");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
