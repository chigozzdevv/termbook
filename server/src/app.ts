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

export function buildApp() {
  const app = Fastify({ logger: false });
  registerErrors(app);
  app.addHook("onRequest", async (req, reply) => {
    if (!req.headers.origin) return;
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    reply.header("access-control-allow-headers", "content-type, x-termbook-app-token, x-termbook-wallet, x-termbook-signature");
    if (req.method === "OPTIONS") return reply.status(204).send();
  });
  app.addHook("preHandler", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.url === "/health" || req.url === "/auth/nonce") return;
    const wallet = req.headers["x-termbook-wallet"];
    const signature = req.headers["x-termbook-signature"];
    if (typeof wallet !== "string" || typeof signature !== "string") {
      return reply.status(401).send({ error: "auth-required" });
    }
    try {
      const identity = await authService.authenticate(wallet, signature);
      (req as typeof req & { user: typeof identity }).user = identity;
    } catch {
      return reply.status(401).send({ error: "auth-invalid" });
    }
  });
  app.get("/health", async () => ({ ok: true }));
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
  return app;
}
