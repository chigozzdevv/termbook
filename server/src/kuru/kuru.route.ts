import type { FastifyInstance } from "fastify";
import { marketHistory, marketSnapshot } from "./market.service.js";
import { requestLimiter } from "../http/http-limit.js";

export function kuruRoute(app: FastifyInstance): void {
  const limit = requestLimiter(120, 60_000);
  for (const [path, read] of [["/kuru/market", marketSnapshot], ["/kuru/trades", marketHistory]] as const) {
    app.get(path, async (req, reply) => {
      if (!limit(req.ip)) return reply.status(429).header("retry-after", "60").send({ error: "kuru-rate-limited" });
      try { return await read(); }
      catch { return reply.status(503).send({ error: "kuru-market-unavailable" }); }
    });
  }
}
