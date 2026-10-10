import { encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { keeperTransaction } from "../chain/keeper.js";
import { logger } from "../logging/logger.js";

const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
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
    const { address, codeHash } = entry as Record<string, unknown>;
    if (Object.keys(entry).some((name) => !["address", "codeHash"].includes(name))
      || typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address)
      || typeof codeHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(codeHash) || /^0x0{64}$/i.test(codeHash)) throw new Error("upgrade-monitor-config-invalid");
    return { address: address as Address, codeHash: codeHash as Hex };
  });
  if (new Set(guards.map((g) => g.address.toLowerCase())).size !== guards.length) throw new Error("upgrade-monitor-config-invalid");
  return { guards, account: privateKeyToAccount(key as Hex) };
}

let running = false;
export async function runUpgradeMonitorWorker(): Promise<number> {
  const config = upgradeMonitorConfig();
  if (!config || running) return 0;
  running = true;
  try {
    const client = monadClient();
    if (await client.getChainId() !== 10143) throw new Error("upgrade-monitor-chain-mismatch");
    let submitted = 0;
    for (const guard of config.guards) {
      try {
        const [finalized, latest] = await Promise.all(["finalized", "latest"].map((blockTag) => client.getBlock({ blockTag: blockTag as "finalized" | "latest" })));
        if (!finalized.hash || finalized.number >= latest.number || latest.timestamp < finalized.timestamp
          || latest.timestamp - finalized.timestamp > 30n) throw new Error("upgrade-monitor-finality-unavailable");
        const code = await client.getCode({ address: guard.address });
        if (!code || keccak256(code).toLowerCase() !== guard.codeHash.toLowerCase()) throw new Error("upgrade-monitor-guard-changed");
        const read = <T>(functionName: string) => client.readContract({ address: guard.address, abi, functionName } as never) as Promise<T>;
        const [proxy, implementation, monitor, proxyHash, implementationHash, validUntil, observedBlock, revoked] = await Promise.all([
          read<Address>("proxy"), read<Address>("implementation"), read<Address>("monitor"), read<Hex>("proxyCodeHash"),
          read<Hex>("implementationCodeHash"), read<bigint>("validUntil"), read<bigint>("observedBlock"), read<boolean>("revoked"),
        ]);
        if (monitor.toLowerCase() !== config.account.address.toLowerCase()) throw new Error("upgrade-monitor-signer-mismatch");
        if (revoked) continue;
        const checks = await Promise.all([finalized.number, latest.number].map(async (blockNumber) => {
          const [slot, proxyCode, implementationCode] = await Promise.all([
            client.getStorageAt({ address: proxy, slot: implementationSlot, blockNumber }),
            client.getCode({ address: proxy, blockNumber }), client.getCode({ address: implementation, blockNumber }),
          ]);
          if (!slot || !/^0x0{24}[a-fA-F0-9]{40}$/.test(slot)) throw new Error("upgrade-monitor-storage-invalid");
          return slot.slice(-40).toLowerCase() === implementation.slice(2).toLowerCase()
            && !!proxyCode && keccak256(proxyCode).toLowerCase() === proxyHash.toLowerCase()
            && !!implementationCode && keccak256(implementationCode).toLowerCase() === implementationHash.toLowerCase();
        }));
        const changed = checks.some((match) => !match);
        if (!changed && (validUntil > latest.timestamp + 60n || finalized.number <= observedBlock)) continue;
        const data = encodeFunctionData({ abi, functionName: changed ? "revoke" : "renew",
          args: changed ? [] : [finalized.number, finalized.hash, finalized.timestamp] } as never);
        await client.simulateContract({ address: guard.address, abi, functionName: changed ? "revoke" : "renew",
          args: changed ? [] : [finalized.number, finalized.hash, finalized.timestamp], account: config.account.address } as never);
        const result = await keeperTransaction({ client, rpcUrl: env.rpcUrl, chainId: 10143, account: config.account,
          operation: changed ? `upgrade-revoke:${guard.address}` : `upgrade-renew:${guard.address}:${finalized.number}`,
          to: guard.address, data });
        if (changed) logger.error("upgrade-monitor-dependency-changed", { guard: guard.address, proxy });
        if (result === "success") submitted++;
      } catch (cause) {
        logger.warn("upgrade-monitor-unavailable", { guard: guard.address,
          reason: cause instanceof Error && /^upgrade-monitor-[a-z-]+$/.test(cause.message) ? cause.message : "upgrade-monitor-check-failed" });
      }
    }
    return submitted;
  } finally { running = false; }
}
