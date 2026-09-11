import { z } from "zod";
import { bytes32Schema } from "./auth.js";

export const recoverySchema = z.object({
  creditId: bytes32Schema,
  kind: z.enum(["partial", "full"]),
  steps: z.array(z.string()).min(1),
});

export type Recovery = z.infer<typeof recoverySchema>;
