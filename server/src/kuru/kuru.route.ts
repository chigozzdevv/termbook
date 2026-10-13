import type { FastifyInstance } from "fastify";
import { marketHistory, marketSnapshot } from "./market.service.js";
import { requestLimiter } from "../http/http-limit.js";
import { marketChart } from "./chart.service.js";
import { z } from "zod";

export function kuruRoute(app: FastifyInstance): void {
  const limit = requestLimiter(120, 60_000);
  app.get<{ Querystring: { interval?: string } }>("/kuru/chart", async (req, reply) => {
    if (!limit(req.ip)) return reply.status(429).header("retry-after", "60").send({ error: "kuru-rate-limited" });
    const interval = z.enum(["1", "5", "15", "60"]).safeParse(req.query.interval ?? "15");
    if (!interval.success) return reply.status(400).send({ error: "kuru-chart-interval-invalid" });
    try { return await marketChart(Number(interval.data)); }
    catch { return reply.status(503).send({ error: "kuru-chart-unavailable" }); }
  });
  for (const [path, read] of [["/kuru/market", marketSnapshot], ["/kuru/trades", marketHistory]] as const) {
    app.get(path, async (req, reply) => {
      if (!limit(req.ip)) return reply.status(429).header("retry-after", "60").send({ error: "kuru-rate-limited" });
      try { return await read(); }
      catch { return reply.status(503).send({ error: "kuru-market-unavailable" }); }
    });
  }
}
