import { z } from "zod";

const apiUrl = z.url().parse(process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001");

const protocolApiUrl = z.url().parse(process.env.NEXT_PUBLIC_TERMBOOK_API_URL ?? "http://127.0.0.1:3002");
export const env = { apiUrl: apiUrl.replace(/\/$/, ""), protocolApiUrl: protocolApiUrl.replace(/\/$/, "") };
