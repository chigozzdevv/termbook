import { creditRepo } from "./credit.repo.js";
import { queue } from "../queue/queue.client.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { termbookCoreAbi } from "@termbook/bindings";

const facilities = ["reserved", "collateral_locking", "collateral_proving", "account_creating", "ready",
  "closing", "closed", "aborted", "liquidating", "recovery_pending", "liquidated"];

export const creditService = {
  async track(input: Record<string, unknown>) {
    const chain = monadClient();
    const details = await chain.readContract({ address: env.core as `0x${string}`, abi: termbookCoreAbi,
      functionName: "creditDetails", args: [input["creditId"] as `0x${string}`], blockTag: "finalized" });
    if (details.revision === 0n || details.borrower.toLowerCase() !== String(input["borrower"]).toLowerCase()
      || details.house.toLowerCase() !== String(input["house"]).toLowerCase()) throw new Error("credit-unavailable");
    const saved = await creditRepo.save({ creditId: input["creditId"], borrower: details.borrower.toLowerCase(),
      house: details.house, bundleId: details.bundleId, facility: facilities[Number(details.facility)] ?? "unknown" });
    await queue.push({ kind: "credit.tracked", payload: { creditId: input["creditId"] } });
    return saved;
  },
  async get(creditId: string) {
    return creditRepo.get(creditId);
  },
  async list(borrower: string) {
    return creditRepo.list(borrower);
  },
};
