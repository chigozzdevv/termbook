import { z } from "zod";

export const authSchema = z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  method: z.literal("POST"), path: z.string().max(2048).regex(/^\/[^\r\n#]*$/),
  bodyHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});
