import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";

export type RecoveryConfig = {
  sourceRpcs: Record<number, string>;
  routeSigner: ReturnType<typeof privateKeyToAccount>;
  riskSigner: `0x${string}`;
  funder: ReturnType<typeof privateKeyToAccount>;
};
export function recoveryConfig(): RecoveryConfig | null {
  const rpcs = process.env["RECOVERY_SOURCE_RPCS"];
  const signer = process.env["RECOVERY_ROUTE_SIGNER_KEY"];
  const riskSigner = process.env["RECOVERY_RISK_SIGNER"];
  const funder = process.env["RECOVERY_FUNDING_KEY"];
  if (!rpcs && !signer && !riskSigner && !funder) return null;
  if (!rpcs || !/^0x[a-fA-F0-9]{64}$/.test(signer ?? "")
    || !/^0x[a-fA-F0-9]{40}$/.test(riskSigner ?? "")
    || !/^0x[a-fA-F0-9]{64}$/.test(funder ?? "")) {
    throw new Error("recovery-config-invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rpcs);
  } catch {
    throw new Error("recovery-config-invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) throw new Error("recovery-config-invalid");
  const sourceRpcs: Record<number, string> = {};
  for (const [chainId, value] of Object.entries(parsed)) {
    const id = Number(chainId);
    if (!Number.isSafeInteger(id) || id <= 0 || typeof value !== "string") throw new Error("recovery-config-invalid");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("recovery-config-invalid");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("recovery-config-invalid");
    sourceRpcs[id] = url.toString();
  }
  const routeAccount = privateKeyToAccount(signer as `0x${string}`);
  if (routeAccount.address.toLowerCase() === riskSigner?.toLowerCase()) throw new Error("recovery-config-invalid");
  return { sourceRpcs, routeSigner: routeAccount, riskSigner: riskSigner as `0x${string}`, funder: privateKeyToAccount(funder as `0x${string}`) };
}

export function assertRecoveryWorkerConfig(): void {
  if (!recoveryConfig()) return;
  if (!env.auroraRoutes || !env.auroraApiKey
    || !/^0x[a-fA-F0-9]{40}$/.test(env.settlementFactory)) {
    throw new Error("recovery-config-invalid");
  }
}
