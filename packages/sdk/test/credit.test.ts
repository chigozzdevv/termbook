import { describe, expect, it, vi } from "vitest";
import { CreditApp } from "../src/app/app.js";
import { Credit } from "../src/credit/credit.js";
import { encodeFunctionData, parseAbi } from "viem";

describe("app", () => {
  it("rejects unknown capability", async () => {
    const app = new CreditApp({} as never, "0x0000000000000000000000000000000000000000");
    await expect(app.execute({ capability: "hack", params: {} })).rejects.toThrow();
  });

  it("rejects a recovery plan for another credit before asking the wallet to sign", async () => {
    const core = `0x${"1".repeat(40)}` as const;
    const id = `0x${"2".repeat(64)}` as const;
    const write = vi.fn();
    const credit = new Credit({ config: { core, chainId: 143 }, rpc: { coreWrite: write },
      authenticatedPost: async () => ({ to: core, chainId: 143, data: encodeFunctionData({
        abi: parseAbi(["function confirmRemoteRecoveryClearance(bytes32,bytes,bytes)"]),
        functionName: "confirmRemoteRecoveryClearance", args: [`0x${"3".repeat(64)}`, "0x01", "0x02"],
      }) }),
    } as never, id);
    await expect(credit.confirmRecoveryClearance()).rejects.toThrow("recovery-clearance-plan-invalid");
    expect(write).not.toHaveBeenCalled();
  });
});
