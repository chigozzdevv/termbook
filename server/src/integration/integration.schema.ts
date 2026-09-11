import { z } from "zod";

export const integrationSchema = z.object({
  versionId: z.string().min(1),
  codeHash: z.string().min(1),
});
