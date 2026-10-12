import { capabilityDefinitionSchema, executionKey } from "@termbook/schema";
import { encodeFunctionData, keccak256, parseAbi, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { integrationRepo } from "../integration/integration.repo.js";
import { logger } from "../logging/logger.js";
import { keeperTransaction } from "./keeper.js";
import { monadClient } from "./monad.client.js";
import { runPythOracleWorker } from "./pyth.worker.js";

const coreAbi = parseAbi(["function priceProtection() view returns(address)"]);
const protectionAbi = parseAbi([
  "function referenceVersion() pure returns(uint256)",
  "function priceReference(bytes32,bytes32,bytes32) view returns(uint256,uint256,uint80,uint256)",
  "function recordPrice(bytes32,bytes32,bytes32)",
  "function rule(bytes32,bytes32,bytes32) view returns((address oracle,bytes32 feedId,address target,bytes4 selector,uint8 callIndex,uint8 priceDecimals,uint16 priceWord,uint16 directionWord,uint16 maxSlippageBps,uint16 maxDeviationBps,uint32 maxAuthorizationAge,uint256 maximumDirection,uint256 minimumDirection))",
]);
type PriceRule = { bundle: Hex; capability: Hex; market: Hex };
const word = (value: unknown): value is Hex => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value) && !/^0x0{64}$/i.test(value);

export function priceReferenceConfig() {
  const enabled = process.env["PRICE_REFERENCE_ENABLED"] ?? "true";
  if (!["true", "false"].includes(enabled)) throw new Error("price-reference-config-invalid");
  if (enabled === "false") return null;
  const raw = process.env["PRICE_REFERENCE_RULES"];
  const key = process.env["ORACLE_KEEPER_KEY"];
  if (!key && !raw) return null;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("price-reference-config-invalid");
  if (Object.entries(process.env).some(([name, value]) => name !== "ORACLE_KEEPER_KEY"
    && /(?:KEEPER|RELAY)_KEY$/.test(name) && value?.toLowerCase() === key.toLowerCase())) throw new Error("oracle-keeper-key-conflict");
  const entries: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(entries) || entries.length > 32) throw new Error("price-reference-config-invalid");
  const rules: PriceRule[] = entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("price-reference-config-invalid");
    const fields = entry as Record<string, unknown>;
    if (Object.keys(fields).length !== 3 || !word(fields.bundle) || !word(fields.capability) || !word(fields.market)) throw new Error("price-reference-config-invalid");
    return { bundle: fields.bundle, capability: fields.capability, market: fields.market };
  });
  if (new Set(rules.map((rule) => JSON.stringify(rule).toLowerCase())).size !== rules.length) throw new Error("price-reference-config-invalid");
  return { account: privateKeyToAccount(key as Hex), rules };
}

export async function runPriceReferenceWorker(): Promise<number> {
  const config = priceReferenceConfig();
  if (!config) return 0;
  const rules = new Map(config.rules.map((rule) => [JSON.stringify(rule).toLowerCase(), rule]));
  for (const integration of await integrationRepo.list()) {
    if (integration.frozen || integration.packageDefinition?.chain_id !== env.monadChainId || !word(integration.versionId)) continue;
    for (const raw of integration.actions ?? []) {
      const action = capabilityDefinitionSchema.parse(raw);
      for (const market of action.price?.markets ?? []) {
        if (!word(market)) throw new Error("price-reference-rule-invalid");
        const rule: PriceRule = { bundle: integration.versionId, capability: keccak256(stringToHex(executionKey(action))), market };
        rules.set(JSON.stringify(rule).toLowerCase(), rule);
      }
    }
  }
  if (!rules.size) return 0;
  if (rules.size > 256) throw new Error("price-reference-capacity-exceeded");
  await runPythOracleWorker();
  const client = monadClient(1);
  if (await client.getChainId() !== env.monadChainId) throw new Error("price-reference-chain-mismatch");
  const block = await client.getBlock({ blockTag: "latest" });
  const protection = await client.readContract({ address: env.core as Hex, abi: coreAbi, functionName: "priceProtection", blockNumber: block.number });
  if (await client.readContract({ address: protection, abi: protectionAbi, functionName: "referenceVersion", blockNumber: block.number }) !== 1n) throw new Error("price-reference-version-unsupported");
  let recorded = 0;
  for (const rule of rules.values()) {
    try {
      const args = [rule.bundle, rule.capability, rule.market] as const;
      const priceRule = await client.readContract({ address: protection, abi: protectionAbi, functionName: "rule", args, blockNumber: block.number });
      if (/^0x0{40}$/i.test(priceRule.oracle) || priceRule.maxAuthorizationAge <= 0) throw new Error("price-reference-rule-unregistered");
      const reference = await client.readContract({ address: protection, abi: protectionAbi, functionName: "priceReference", args, blockNumber: block.number }).catch(() => undefined);
      if (reference && block.timestamp >= reference[3] && block.timestamp - reference[3] < BigInt(Math.max(1, Math.floor(priceRule.maxAuthorizationAge / 2)))) continue;
      await client.simulateContract({ address: protection, abi: protectionAbi, functionName: "recordPrice", args, account: config.account.address });
      const result = await keeperTransaction({ client, rpcUrl: env.rpcUrl, chainId: env.monadChainId, account: config.account,
        operation: `price-reference:${rule.bundle}:${rule.capability}:${rule.market}:${block.number}`, to: protection,
        data: encodeFunctionData({ abi: protectionAbi, functionName: "recordPrice", args }) });
      if (result === "reverted") throw new Error("price-reference-record-reverted");
      if (result === "success") recorded++;
    } catch (error) {
      logger.warn("price-reference-unavailable", { bundle: rule.bundle, capability: rule.capability, market: rule.market,
        reason: error instanceof Error ? error.message.match(/^(?:price-reference|keeper)-[a-z-]+(?=:|$)/)?.[0] ?? "price-source-unavailable" : "price-source-unavailable" });
    }
  }
  return recorded;
}
