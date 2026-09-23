import { z } from "zod";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());

export const remoteActionSchema = z.object({
  creditId: word,
  kind: z.enum(["release", "seize"]),
  authorizationTxHash: word,
}).strict();

export const remoteActionSourceTxSchema = z.object({
  actionHash: word,
  sourceTxHash: word,
}).strict();

export const cancelRemoteActionSchema = z.object({
  creditId: word,
  kind: z.enum(["release", "seize"]),
}).strict();
