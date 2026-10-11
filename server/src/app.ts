import Fastify from "fastify";
import { registerErrors } from "./http/http.middleware.js";
import { authRoute } from "./auth/auth.route.js";
import { intentRoute } from "./intent/intent.route.js";
import { quoteRoute } from "./quote/quote.route.js";
import { houseRoute } from "./house/house.route.js";
import { creditRoute } from "./credit/credit.route.js";
import { collateralRoute } from "./collateral/collateral.route.js";
import { settlementRoute } from "./settlement/settlement.route.js";
import { liquidityRoute } from "./liquidity/liquidity.route.js";
import { integrationRoute } from "./integration/integration.route.js";
import { recoveryRoute } from "./recovery/recovery.route.js";
import { catalogRoute } from "./catalog/catalog.route.js";
import { authService } from "./auth/auth.service.js";
import { canonicalJson } from "@termbook/schema";
import { hashMessage } from "viem";
import { requestLimiter } from "./http/http-limit.js";
import { readiness } from "./http/readiness.js";
import { kuruRoute } from "./kuru/kuru.route.js";

export function buildApp() {
  const app = Fastify({ logger: false });
  registerErrors(app);
  const nonceLimit = requestLimiter(20, 60_000);
  const integrationLimit = requestLimiter(30, 60_000);
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.split("?")[0] === "/integrations/source" && !integrationLimit(req.ip)) {
      return reply.status(429).header("retry-after", "60").send({ error: "integration-rate-limited" });
    }
    if (req.method === "POST" && req.url === "/auth/nonce" && !nonceLimit(req.ip)) {
      return reply.status(429).header("retry-after", "60").send({ error: "auth-rate-limited" });
    }
    if (!req.headers.origin) return;
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    reply.header("access-control-allow-headers", "content-type, x-termbook-app-token, x-termbook-wallet, x-termbook-signature, x-termbook-nonce");
    if (req.method === "OPTIONS") return reply.status(204).send();
  });
  app.addHook("preHandler", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.url === "/health" || req.url === "/auth/nonce") return;
    const wallet = req.headers["x-termbook-wallet"];
    const signature = req.headers["x-termbook-signature"];
    const nonce = req.headers["x-termbook-nonce"];
    if (typeof wallet !== "string" || typeof signature !== "string" || typeof nonce !== "string") {
      return reply.status(401).send({ error: "auth-required" });
    }
    try {
      const identity = await authService.authenticate(wallet, signature, nonce,
        { method: "POST", path: req.url, bodyHash: hashMessage(canonicalJson(req.body)) });
      (req as typeof req & { user: typeof identity }).user = identity;
    } catch {
      return reply.status(401).send({ error: "auth-invalid" });
    }
  });
  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async (_, reply) => {
    const ok = await readiness().catch(() => false);
    return reply.status(ok ? 200 : 503).send({ ok });
  });
  authRoute(app);
  intentRoute(app);
  quoteRoute(app);
  houseRoute(app);
  creditRoute(app);
  collateralRoute(app);
  settlementRoute(app);
  liquidityRoute(app);
  integrationRoute(app);
  recoveryRoute(app);
  catalogRoute(app);
  kuruRoute(app);
  return app;
}
