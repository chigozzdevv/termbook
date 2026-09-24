import { describe, expect, it, vi } from "vitest";
import { CreditApp } from "../src/app/app.js";
import type { TermbookClient } from "../src/client/client.js";

const creditId = `0x${"1".repeat(64)}` as const;
const tx = `0x${"2".repeat(64)}` as const;

describe("app exit", () => {
  it("uses the approved exit path without a draw or health preview", async () => {
    const ready = vi.fn(async () => undefined);
    const coreWrite = vi.fn(async () => tx);
    const wait = vi.fn(async () => undefined);
    const client = { ready, rpc: { coreWrite, wait } } as unknown as TermbookClient;
    expect(await new CreditApp(client, creditId).exit("0x0102")).toEqual({ tx });
    expect(ready).toHaveBeenCalledOnce();
    expect(coreWrite).toHaveBeenCalledWith("exitApp", [creditId, "0x0102"]);
    expect(wait).toHaveBeenCalledWith(tx);
  });

  it("rejects malformed instructions before requesting a transaction", async () => {
    const ready = vi.fn();
    const app = new CreditApp({ ready } as unknown as TermbookClient, creditId);
    await expect(app.exit("0x123")).rejects.toThrow("param-invalid");
    expect(ready).not.toHaveBeenCalled();
  });
});
