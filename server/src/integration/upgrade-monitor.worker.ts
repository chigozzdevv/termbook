import { createPublicClient, encodeFunctionData, keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { keeperTransaction, reconcileKeeperWallet } from "../chain/keeper.js";
import { logger } from "../logging/logger.js";
import { readProxyImplementation } from "../chain/proxy.js";
import { approvedRuntimeReviews } from "./runtime-review.js";
import { runtimeReviewSummary } from "@termbook/sdk";
import { pacedHttp } from "../chain/rpc.transport.js";

const abi = parseAbi([
  "function proxy() view returns(address)", "function implementation() view returns(address)",
  "function monitor() view returns(address)", "function proxyCodeHash() view returns(bytes32)",
  "function implementationCodeHash() view returns(bytes32)", "function validUntil() view returns(uint64)",
  "function observedBlock() view returns(uint64)", "function revoked() view returns(bool)",
  "function renew(uint64,bytes32,uint64)", "function revoke()",
]);

export function upgradeMonitorConfig() {
  const raw = process.env["TESTNET_UPGRADE_GUARDS"];
  const key = process.env["UPGRADE_MONITOR_KEY"];
  if (!raw && !key) return null;
  if (env.monadChainId !== 10143 || !raw || !key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("upgrade-monitor-config-invalid");
  if (Object.entries(process.env).some(([name, value]) => name !== "UPGRADE_MONITOR_KEY"
    && /(?:KEEPER|RELAY|MONITOR)_KEY$/.test(name) && value?.toLowerCase() === key.toLowerCase())) throw new Error("upgrade-monitor-key-conflict");
  const entries: unknown = JSON.parse(raw);
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 16) throw new Error("upgrade-monitor-config-invalid");
  const guards = entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("upgrade-monitor-config-invalid");
    const { address, codeHash, runtimeReview } = entry as Record<string, unknown>;
    if (Object.keys(entry).some((name) => !["address", "codeHash", "runtimeReview"].includes(name))
      || runtimeReview !== undefined && (typeof runtimeReview !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(runtimeReview))
      || typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address)
      || typeof codeHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(codeHash) || /^0x0{64}$/i.test(codeHash)) throw new Error("upgrade-monitor-config-invalid");
    return { address: address as Address, codeHash: codeHash as Hex, runtimeReview: runtimeReview as Hex | undefined };
  });
  if (new Set(guards.map((g) => g.address.toLowerCase())).size !== guards.length) throw new Error("upgrade-monitor-config-invalid");
  return { guards, account: privateKeyToAccount(key as Hex) };
}

let running = false;
let monitorClient: { url: string; client: PublicClient } | undefined;
export async function runUpgradeMonitorWorker(): Promise<number> {
  const config = upgradeMonitorConfig();
  if (!config || running) return 0;
  running = true;
  try {
    const rpcUrl = process.env["UPGRADE_MONITOR_RPC_URL"] || env.rpcUrl;
    if (rpcUrl !== env.rpcUrl && monitorClient?.url !== rpcUrl) monitorClient = { url: rpcUrl,
      client: createPublicClient({ chain: monadTestnet, transport: pacedHttp(rpcUrl, 8, 2) }) };
    const client = rpcUrl === env.rpcUrl ? monadClient(2) : monitorClient!.client;
    if (await client.getChainId() !== 10143) throw new Error("upgrade-monitor-chain-mismatch");
    const reviews = await approvedRuntimeReviews();
    const pending = await reconcileKeeperWallet(client, 10143, config.account.address);
    if (pending === "pending" || pending === "busy") return 0;
    let submitted = 0;
    const leases = await Promise.all(config.guards.map(async (guard) => ({ guard,
      expiry: await client.readContract({ address: guard.address, abi, functionName: "validUntil" }).catch(() => 0n) })));
    leases.sort((a, b) => a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0);
    for (const { guard } of leases) {
      let phase = "guard";
      try {
        const fields = ["proxy", "implementation", "monitor", "proxyCodeHash", "implementationCodeHash", "validUntil", "observedBlock", "revoked"] as const;
        const [code, state] = await Promise.all([
          client.getCode({ address: guard.address }),
          client.multicall({ contracts: fields.map((functionName) => ({ address: guard.address, abi, functionName })),
            multicallAddress: monadTestnet.contracts.multicall3.address, allowFailure: false }),
        ]);
        if (!code || keccak256(code).toLowerCase() !== guard.codeHash.toLowerCase()) throw new Error("upgrade-monitor-guard-changed");
        const [proxy, implementation, monitor, proxyHash, implementationHash, validUntil, observedBlock, revoked] =
          state as [Address, Address, Address, Hex, Hex, bigint, bigint, boolean];
        if (monitor.toLowerCase() !== config.account.address.toLowerCase()) throw new Error("upgrade-monitor-signer-mismatch");
        if (revoked) continue;
        phase = "headers";
        const finalized = await client.getBlock({ blockTag: "finalized" });
        const latest = await client.getBlock({ blockTag: "latest" });
        if (!finalized.hash || finalized.number > latest.number || latest.timestamp < finalized.timestamp
          || latest.timestamp - finalized.timestamp > 30n) throw new Error("upgrade-monitor-finality-unavailable");
        phase = "implementation";
        const checks = await Promise.all([finalized.number, latest.number].map(async (blockNumber) => {
          const [layout, proxyCode, implementationCode] = await Promise.all([
            readProxyImplementation(client, proxy, blockNumber),
            client.getCode({ address: proxy, blockNumber }), client.getCode({ address: implementation, blockNumber }),
          ]);
          return layout?.implementation.toLowerCase() === implementation.toLowerCase()
            && !!proxyCode && keccak256(proxyCode).toLowerCase() === proxyHash.toLowerCase()
            && !!implementationCode && keccak256(implementationCode).toLowerCase() === implementationHash.toLowerCase();
        }));
        const review = reviews.find((r) => r.target.toLowerCase() === proxy.toLowerCase());
        const changed = checks.some((match) => !match) || !!guard.runtimeReview && (!review
          || runtimeReviewSummary(review).id.toLowerCase() !== guard.runtimeReview.toLowerCase())
          || !!review && (review.expires_at <= Number(latest.timestamp)
          || review.implementation.toLowerCase() !== implementation.toLowerCase() || review.code_hash.toLowerCase() !== implementationHash.toLowerCase());
        if (!changed && (validUntil > latest.timestamp + 120n || finalized.number <= observedBlock)) continue;
        const data = encodeFunctionData({ abi, functionName: changed ? "revoke" : "renew",
          args: changed ? [] : [finalized.number, finalized.hash, finalized.timestamp] } as never);
        phase = "simulation";
        await client.simulateContract({ address: guard.address, abi, functionName: changed ? "revoke" : "renew",
          args: changed ? [] : [finalized.number, finalized.hash, finalized.timestamp], account: config.account.address } as never);
        phase = "renewal";
        const result = await keeperTransaction({ client, rpcUrl, chainId: 10143, account: config.account,
          operation: changed ? `upgrade-revoke:${guard.address}` : `upgrade-renew:${guard.address}:${finalized.number}`,
          to: guard.address, data });
        if (changed) logger.error("upgrade-monitor-dependency-changed", { guard: guard.address, proxy });
        if (result === "success") submitted++;
        if (result === "pending" || result === "busy") break;
      } catch (cause) {
        const failure = cause as { code?: number; cause?: { code?: number } };
        logger.warn("upgrade-monitor-unavailable", { guard: guard.address, phase, errorName: cause instanceof Error ? cause.name : "unknown",
          errorCode: failure?.code ?? failure?.cause?.code,
          reason: cause instanceof Error ? cause.message.match(/^(?:upgrade-monitor|keeper)-[a-z-]+(?=:|$)/)?.[0]
            ?? "upgrade-monitor-check-failed" : "upgrade-monitor-check-failed" });
      }
    }
    return submitted;
  } finally { running = false; }
}
