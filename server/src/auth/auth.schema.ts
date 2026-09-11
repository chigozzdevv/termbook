import { z } from "zod";

export const authSchema = z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });
