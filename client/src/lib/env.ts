import { z } from "zod";

const apiUrl = z.url().parse(process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001");

export const env = { apiUrl: apiUrl.replace(/\/$/, "") };
