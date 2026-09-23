import { termbookCoreAbi } from "@termbook/bindings";
import { parseAbi } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { queue } from "../queue/queue.client.js";
import { solanaProofConfig } from "./solana.config.js";
import { solanaRepo } from "./solana.repo.js";
import type { z } from "zod";
import type { solanaTrackSchema } from "./solana.schema.js";

const solanaAbi = parseAbi([
  "function solanaCollateral(bytes32) view returns (bool)",
  "function solanaLockPdaOf(bytes32) view returns (bytes32)",
]);

export const solanaService = {
  async track(input: z.infer<typeof solanaTrackSchema>, requester: string) {
    if (!solanaProofConfig()) throw new Error("solana-proof-worker-unavailable");
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-monad-chain-mismatch");
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    const [credit, solana, pda] = await Promise.all([
      chain.readContract({ address: env.core as `0x${string}`, abi: termbookCoreAbi,
        functionName: "creditDetails", args: [input.creditId], blockNumber: finalized.number }),
      chain.readContract({ address: env.core as `0x${string}`, abi: solanaAbi,
        functionName: "solanaCollateral", args: [input.creditId], blockNumber: finalized.number }),
      chain.readContract({ address: env.core as `0x${string}`, abi: solanaAbi,
        functionName: "solanaLockPdaOf", args: [input.creditId], blockNumber: finalized.number }),
    ]);
    if (!solana || !credit.collateralBound || credit.borrower.toLowerCase() !== requester.toLowerCase()
      || credit.lockId.toLowerCase() !== input.lockId || pda.toLowerCase() !== input.lockPda) {
      throw new Error("solana-track-binding-mismatch");
    }
    const saved = await solanaRepo.track(input);
    if (saved.state !== "proven" && saved.state !== "manual_review") {
      await queue.push({ kind: "collateral.solana-lock", payload: { lockId: input.lockId } });
    }
    return { lockId: saved.lockId, creditId: saved.creditId, lockPda: saved.lockPda, state: saved.state };
  },
  async list(creditId: string) {
    return solanaRepo.list(creditId.toLowerCase());
  },
};
