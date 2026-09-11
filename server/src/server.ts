import { buildApp } from "./app.js";
import { connectDb } from "./database/database.client.js";
import { env, assertRuntimeConfig } from "./config/env.js";
import { logger } from "./logging/logger.js";

async function main(): Promise<void> {
  assertRuntimeConfig();
  await connectDb();
  const app = buildApp();
  await app.listen({ port: env.port, host: "0.0.0.0" });
  logger.info(`server-listening:${env.port}`);
}

void main();
