import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { privateKeyToAccount } from "viem/accounts";
import { assertRecoveryWorkerConfig, recoveryConfig } from "../../src/recovery/recovery.config.js";

const saved = {
  rpcs: process.env["RECOVERY_SOURCE_RPCS"],
  signer: process.env["RECOVERY_ROUTE_SIGNER_KEY"],
  riskSigner: process.env["RECOVERY_RISK_SIGNER"],
  funder: process.env["RECOVERY_FUNDING_KEY"],
  routes: env.auroraRoutes,
  apiKey: env.auroraApiKey,
  factory: env.settlementFactory,
};

afterEach(() => {
  for (const [key, value] of [
    ["RECOVERY_SOURCE_RPCS", saved.rpcs],
    ["RECOVERY_ROUTE_SIGNER_KEY", saved.signer],
    ["RECOVERY_RISK_SIGNER", saved.riskSigner],
    ["RECOVERY_FUNDING_KEY", saved.funder],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  env.auroraRoutes = saved.routes;
  env.auroraApiKey = saved.apiKey;
  env.settlementFactory = saved.factory;
});

describe("recovery worker configuration", () => {
  it("stays inactive only when the entire source funding configuration is absent", () => {
    delete process.env["RECOVERY_SOURCE_RPCS"];
    delete process.env["RECOVERY_ROUTE_SIGNER_KEY"];
    delete process.env["RECOVERY_RISK_SIGNER"];
    delete process.env["RECOVERY_FUNDING_KEY"];
    expect(recoveryConfig()).toBeNull();
    process.env["RECOVERY_SOURCE_RPCS"] = JSON.stringify({ 1: "https://example.com" });
    expect(() => recoveryConfig()).toThrow("recovery-config-invalid");
  });

  it("requires a settlement route before enabling a source signing key", () => {
    process.env["RECOVERY_SOURCE_RPCS"] = JSON.stringify({ 1: "https://example.com" });
    process.env["RECOVERY_ROUTE_SIGNER_KEY"] = `0x${"1".repeat(64)}`;
    process.env["RECOVERY_RISK_SIGNER"] = `0x${"3".repeat(40)}`;
    process.env["RECOVERY_FUNDING_KEY"] = `0x${"2".repeat(64)}`;
    env.auroraRoutes = "";
    expect(() => assertRecoveryWorkerConfig()).toThrow("recovery-config-invalid");
  });

  it("rejects a risk signer that is the same account as the route signer", () => {
    process.env["RECOVERY_SOURCE_RPCS"] = JSON.stringify({ 1: "https://example.com" });
    process.env["RECOVERY_ROUTE_SIGNER_KEY"] = `0x${"1".repeat(64)}`;
    process.env["RECOVERY_RISK_SIGNER"] = privateKeyToAccount(`0x${"1".repeat(64)}`).address;
    process.env["RECOVERY_FUNDING_KEY"] = `0x${"2".repeat(64)}`;
    expect(() => recoveryConfig()).toThrow("recovery-config-invalid");
  });
});
