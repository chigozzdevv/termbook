import type { FastifyInstance } from "fastify";
import { requestLimiter } from "../http/http-limit.js";
import { contactSchema } from "./contact.schema.js";
import { sendContact } from "./contact.service.js";

export function contactRoute(app: FastifyInstance): void {
  const allow = requestLimiter(5, 15 * 60_000);
  app.post("/contact", {
    bodyLimit: 8192,
    onRequest: async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!allow(request.ip)) {
        return reply.status(429).header("retry-after", "900").send({ error: "contact-rate-limited" });
      }
    },
  }, async (request) => {
    await sendContact(contactSchema.parse(request.body));
    return { ok: true };
  });
}
