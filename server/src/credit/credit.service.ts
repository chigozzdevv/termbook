import { creditRepo } from "./credit.repo.js";
import { queue } from "../queue/queue.client.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { termbookCoreAbi } from "@termbook/bindings";

const facilities = ["reserved", "collateral_locking", "collateral_proving", "account_creating", "ready",
  "closing", "closed", "aborted", "liquidating", "recovery_pending", "liquidated"];

export const creditService = {
  async refresh(creditId: string) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(creditId)) throw new Error("param-invalid");
    const id = creditId.toLowerCase();
    const chain = monadClient();
    const details = await chain.readContract({ address: env.core as `0x${string}`, abi: termbookCoreAbi,
      functionName: "creditDetails", args: [id as `0x${string}`], blockTag: "finalized" });
    const revision = Number(details.revision);
    if (!Number.isSafeInteger(revision) || revision <= 0) throw new Error("credit-unavailable");
    return creditRepo.save({ creditId: id, borrower: details.borrower.toLowerCase(), house: details.house,
      bundleId: details.bundleId, facility: facilities[Number(details.facility)] ?? "unknown",
      debt: details.debt.toString(), revision });
  },
  async track(input: Record<string, unknown>) {
    const id = String(input["creditId"]).toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(id)) throw new Error("param-invalid");
    const chain = monadClient();
    const details = await chain.readContract({ address: env.core as `0x${string}`, abi: termbookCoreAbi,
      functionName: "creditDetails", args: [id as `0x${string}`], blockTag: "finalized" });
    const revision = Number(details.revision);
    if (details.revision === 0n || details.borrower.toLowerCase() !== String(input["borrower"]).toLowerCase()
      || details.house.toLowerCase() !== String(input["house"]).toLowerCase()
      || !Number.isSafeInteger(revision)) throw new Error("credit-unavailable");
    const saved = await creditRepo.save({ creditId: id, borrower: details.borrower.toLowerCase(),
      house: details.house, bundleId: details.bundleId, facility: facilities[Number(details.facility)] ?? "unknown",
      debt: details.debt.toString(), revision });
    await queue.push({ kind: "credit.tracked", payload: { creditId: id } });
    return saved;
  },
  async get(creditId: string) {
    const id = creditId.toLowerCase();
    const tracked = await creditRepo.get(id);
    return tracked ? creditService.refresh(id) : null;
  },
  async list(borrower: string) {
    return creditRepo.list(borrower);
  },
};
