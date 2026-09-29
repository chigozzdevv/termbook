import type { FastifyInstance } from "fastify";
import { HttpError } from "./http.errors.js";
import { ZodError } from "zod";

export function registerErrors(app: FastifyInstance): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: "validation-failed", issues: err.issues });
    const message = err instanceof Error ? err.message : "internal";
    if (message === "auth-rate-limited") return reply.status(429).send({ error: message });
    if (message.endsWith("-conflict")) return reply.status(409).send({ error: message });
    if (message === "permission-denied" || message === "auth-invalid") return reply.status(403).send({ error: message });
    if (message === "application-state-unavailable" || message === "integration-draft-trace-unavailable"
      || message === "integration-source-unavailable" || message === "integration-config-unavailable") {
      return reply.status(503).send({ error: message });
    }
    if (message.endsWith("-not-found")) return reply.status(404).send({ error: message });
    if (message.startsWith("offer-") || message.startsWith("operation-") || message.startsWith("param-")
      || message.startsWith("quote-") || message.startsWith("integration-")
      || message.startsWith("application-") || message === "auth-expired") return reply.status(400).send({ error: message });
    return reply.status(500).send({ error: "internal" });
  });
}
