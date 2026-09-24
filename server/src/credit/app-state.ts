import { keccak256, parseAbi, type Address, type Hex } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

const coreAbi = parseAbi([
  "function healthSource() view returns (address)",
  "function appRecoveryAdapterOfBundle(bytes32) view returns (address)",
]);
const healthAbi = parseAbi(["function readers(bytes32) view returns (address,uint256,bool,uint256,bytes32)"]);
const readerAbi = parseAbi([
  "function core() view returns (address)",
  "function bundleId() view returns (bytes32)",
  "function appReader() view returns (address)",
  "function appReaderCodeHash() view returns (bytes32)",
  "function recoveryAdapter() view returns (address)",
]);
const appAbi = parseAbi([
  "function readAppValue(bytes32,address,address) view returns (int256,uint16,uint128,uint256)",
  "function positionCount(bytes32,address) view returns (uint256)",
  "function positionAt(bytes32,address,uint256) view returns (bytes32,bytes32)",
  "function pendingCount(bytes32,address) view returns (uint256)",
  "function pendingAt(bytes32,address,uint256) view returns (bytes32,bytes32,uint256,uint256)",
]);
const vaultAbi = parseAbi(["function asset() view returns (address)"]);
const maxItems = 32n;
const zeroAddress = /^0x0{40}$/i;
const zeroId = /^0x0{64}$/i;

export async function readAppState(creditId: Hex, collection: "positions" | "pending") {
  try {
    const chain = monadClient();
    const block = await chain.getBlock({ blockTag: "finalized" });
    const core = env.core as Address;
    const [credit, healthSource] = await Promise.all([
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
        args: [creditId], blockNumber: block.number }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "healthSource", blockNumber: block.number }),
    ]);
    if (credit.revision === 0n || zeroAddress.test(credit.account) || zeroAddress.test(credit.vault)
      || zeroAddress.test(healthSource)) throw new Error("application-state-unavailable");
    const [config, settlementAsset] = await Promise.all([
      chain.readContract({ address: healthSource, abi: healthAbi, functionName: "readers",
        args: [credit.bundleId], blockNumber: block.number }),
      chain.readContract({ address: credit.vault, abi: vaultAbi, functionName: "asset", blockNumber: block.number }),
    ]);
    const reader = config[0];
    if (!config[2] || config[1] === 0n || zeroAddress.test(reader) || zeroAddress.test(settlementAsset)
      || config[3] === 0n) throw new Error("application-state-unavailable");
    const [readerCode, readerCore, readerBundle, appReader, appCodeHash, readerAdapter, coreAdapter] = await Promise.all([
      chain.getBytecode({ address: reader, blockNumber: block.number }),
      chain.readContract({ address: reader, abi: readerAbi, functionName: "core", blockNumber: block.number }),
      chain.readContract({ address: reader, abi: readerAbi, functionName: "bundleId", blockNumber: block.number }),
      chain.readContract({ address: reader, abi: readerAbi, functionName: "appReader", blockNumber: block.number }),
      chain.readContract({ address: reader, abi: readerAbi, functionName: "appReaderCodeHash", blockNumber: block.number }),
      chain.readContract({ address: reader, abi: readerAbi, functionName: "recoveryAdapter", blockNumber: block.number }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "appRecoveryAdapterOfBundle",
        args: [credit.bundleId], blockNumber: block.number }),
    ]);
    if (!readerCode || keccak256(readerCode) !== config[4] || readerCore.toLowerCase() !== core.toLowerCase()
      || readerBundle.toLowerCase() !== credit.bundleId.toLowerCase() || zeroAddress.test(appReader)
      || zeroAddress.test(readerAdapter) || readerAdapter.toLowerCase() !== coreAdapter.toLowerCase()) {
      throw new Error("application-state-unavailable");
    }
    const [appCode, valuation] = await Promise.all([
      chain.getBytecode({ address: appReader, blockNumber: block.number }),
      chain.readContract({ address: appReader, abi: appAbi, functionName: "readAppValue",
        args: [creditId, credit.account, settlementAsset], blockNumber: block.number }),
    ]);
    if (!appCode || keccak256(appCode) !== appCodeHash || valuation[1] > 10_000 || valuation[3] === 0n
      || valuation[3] > block.timestamp || block.timestamp - valuation[3] > config[3]) {
      throw new Error("application-state-unavailable");
    }
    const [positionCount, pendingCount] = await Promise.all([
      chain.readContract({ address: appReader, abi: appAbi, functionName: "positionCount",
        args: [creditId, credit.account], blockNumber: block.number }),
      chain.readContract({ address: appReader, abi: appAbi, functionName: "pendingCount",
        args: [creditId, credit.account], blockNumber: block.number }),
    ]);
    if (positionCount > maxItems || pendingCount > maxItems) throw new Error("application-state-unavailable");
    const count = collection === "positions" ? positionCount : pendingCount;
    const indices = Array.from({ length: Number(count) }, (_, index) => BigInt(index));
    if (collection === "positions") {
      const rows = await Promise.all(indices.map((index) => chain.readContract({ address: appReader,
        abi: appAbi, functionName: "positionAt", args: [creditId, credit.account, index], blockNumber: block.number })));
      const positions = rows.map(([positionId, marketId]) => ({ positionId, marketId }));
      if (positions.some(({ positionId }) => zeroId.test(positionId))
        || new Set(positions.map(({ positionId }) => positionId.toLowerCase())).size !== positions.length) {
        throw new Error("application-state-unavailable");
      }
      return { creditId, revision: credit.revision.toString(), blockNumber: block.number.toString(),
        observedAt: valuation[3].toString(), positions };
    }
    const rows = await Promise.all(indices.map((index) => chain.readContract({ address: appReader,
      abi: appAbi, functionName: "pendingAt", args: [creditId, credit.account, index], blockNumber: block.number })));
    const pending = rows.map(([actionId, positionId, remainingLiability, deadline]) => ({
      actionId, positionId, remainingLiability: remainingLiability.toString(), deadline: deadline.toString(),
    }));
    if (pending.some(({ actionId, deadline }) => zeroId.test(actionId) || deadline === "0")
      || new Set(pending.map(({ actionId }) => actionId.toLowerCase())).size !== pending.length) {
      throw new Error("application-state-unavailable");
    }
    return { creditId, revision: credit.revision.toString(), blockNumber: block.number.toString(),
      observedAt: valuation[3].toString(), pending };
  } catch {
    throw new Error("application-state-unavailable");
  }
}
