import Fastify from "fastify";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { contactRoute } from "../src/contact/contact.route.js";
import { registerErrors } from "../src/http/http.middleware.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
config({ path: [resolve(repo, ".env"), resolve(repo, "server/.env")], quiet: true });
const app = Fastify({ logger: false });
registerErrors(app);
app.addHook("onRequest", async (request, reply) => {
  if (!request.headers.origin) return;
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-methods", "POST, OPTIONS");
  reply.header("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") return reply.status(204).send();
});
contactRoute(app);
const port = Number(process.env["CONTACT_PORT"] ?? 3001);
await app.listen({ host: "127.0.0.1", port });
console.log(`Termbook contact API: http://127.0.0.1:${port}`);
