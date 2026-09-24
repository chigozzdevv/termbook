import { houseRepo } from "./house.repo.js";
import { intentService } from "../intent/intent.service.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

const coreHouseAbi = [{ type: "function", name: "houseRegistry", stateMutability: "view",
  inputs: [], outputs: [{ type: "address" }] }] as const;
const registeredHouseAbi = [{ type: "function", name: "houses", stateMutability: "view",
  inputs: [{ type: "address" }], outputs: [{ type: "address" }, { type: "address" },
    { type: "address" }, { type: "bool" }] }] as const;

export const houseService = {
  async register(input: Record<string, unknown>) {
    return houseRepo.upsert(input);
  },
  async list() {
    return houseRepo.list();
  },
  async intents(house: string, requester: string, cursor?: { createdAt: Date; id: string }) {
    const registered = await houseRepo.get(house);
    if (!registered || typeof registered.asset !== "string" || typeof registered.vault !== "string"
      || !/^0x[a-fA-F0-9]{40}$/.test(registered.asset)) {
      throw new Error("house-unavailable");
    }
    const chain = monadClient();
    const block = await chain.getBlock({ blockTag: "finalized" });
    const registry = await chain.readContract({ address: env.core as `0x${string}`,
      abi: coreHouseAbi, functionName: "houseRegistry", blockNumber: block.number });
    if (!/^0x[a-fA-F0-9]{40}$/.test(registry) || /^0x0{40}$/i.test(registry)) throw new Error("house-unavailable");
    const [vault, asset, manager, active] = await chain.readContract({ address: registry,
      abi: registeredHouseAbi, functionName: "houses", args: [house as `0x${string}`], blockNumber: block.number });
    if (!active || vault.toLowerCase() !== registered.vault.toLowerCase()
      || asset.toLowerCase() !== registered.asset.toLowerCase()) throw new Error("house-unavailable");
    if (requester.toLowerCase() !== house.toLowerCase() && requester.toLowerCase() !== manager.toLowerCase()) {
      throw new Error("permission-denied");
    }
    return intentService.listOpen(asset, cursor);
  },
};
