import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { encodeAbiParameters, keccak256, parseAbi, stringToHex, zeroHash, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { termbookCoreAbi, houseRegistryAbi, houseVaultAbi, reservationManagerAbi, integrationRegistryAbi, oracleRegistryAbi, verifierRegistryAbi } from "@termbook/bindings";
import { collateralMarketSchema } from "@termbook/schema";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { intentRepo } from "../intent/intent.repo.js";
import { quoteRepo } from "../quote/quote.repo.js";
import { quoteService } from "../quote/quote.service.js";
import { quoteSchema } from "../quote/quote.schema.js";
import { solanaAlias, solanaQuoteDigest, type SolanaQuoteIdentity } from "../quote/solana.js";
import { logger } from "../logging/logger.js";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const configSchema = z.array(z.object({ keyFile: z.string().min(1), house: address, vault: address,
  asset: address, reader: address, bundles: z.array(z.string().regex(/^0x[a-fA-F0-9]{64}$/)).min(1),
  maxLimit: z.string().regex(/^[1-9]\d*$/).refine((v) => BigInt(v) <= 100_000n),
  aprBps: z.number().int().min(0).max(10_000), setupSeconds: z.number().int().min(300).max(7200),
}).strict()).min(1).max(10);
const readerAbi = parseAbi([
  "function oracleRegistry() view returns(address)",
  "function markets(bytes32) view returns(bytes32,bytes32,bytes32,uint16,uint8,uint8,uint128,bool)",
]);

export function testnetOfferConfig() {
  const raw = process.env["TESTNET_HOUSE_OFFERS"];
  if (!raw) return [];
  if (env.monadChainId !== 10143 || process.env["NODE_ENV"] === "production") throw new Error("testnet-house-offers-forbidden");
  return configSchema.parse(JSON.parse(raw));
}

export function testnetOfferLimit(intent: Record<string, unknown>, policy: readonly unknown[], maximum: bigint, cash: bigint): bigint | undefined {
  const duration = Number(intent["duration"]), funding = BigInt(String(intent["actionFunding"] ?? "0"));
  if (intent["used"] === true || intent["status"] !== "open" || Number(intent["expiresAt"]) <= Math.floor(Date.now() / 1000) + 30
    || !policy[12] || !policy[13] || !Number.isSafeInteger(duration) || duration < Number(policy[2]) || duration > Number(policy[3])
    || funding <= 0n || funding > maximum || funding > BigInt(String(policy[1])) || funding > cash
    || intent["limit"] !== undefined && funding > BigInt(String(intent["limit"]))) return undefined;
  return funding;
}

export async function runTestnetHouseOffers(): Promise<number> {
  const operators = testnetOfferConfig();
  if (!operators.length) return 0;
  const markets = z.array(collateralMarketSchema).parse(JSON.parse(env.collateralMarkets));
  const client = monadClient();
  if (await client.getChainId() !== 10143) throw new Error("testnet-house-offers-chain-mismatch");
  let count = 0;
  for (const operator of operators) {
    const intents = (await intentRepo.listOpen(operator.asset.toLowerCase())).filter((intent) => operator.bundles.includes(String(intent.bundleId))).slice(0, 10);
    if (!intents.length) continue;
    const key = JSON.parse(await readFile(operator.keyFile, "utf8")) as { privateKey?: Hex };
    if (!key.privateKey || !/^0x[a-fA-F0-9]{64}$/.test(key.privateKey)) throw new Error("testnet-house-key-invalid");
    const signer = privateKeyToAccount(key.privateKey);
    if (signer.address.toLowerCase() !== operator.house.toLowerCase()) throw new Error("testnet-house-signer-mismatch");
    for (const intent of intents) {
      if ((await quoteRepo.list(String(intent.intentId))).some((q) => String(q.house).toLowerCase() === operator.house.toLowerCase())) continue;
      try {
        const block = await client.getBlock({ blockTag: "finalized" });
        const read = <T>(target: string, abi: Abi, functionName: string, args: readonly unknown[] = []) => client.readContract({
          address: target as Address, abi, functionName, args, blockNumber: block.number,
        }) as Promise<T>;
        const [registry, reservation, integration] = await Promise.all([
          read<Address>(env.core, termbookCoreAbi, "houseRegistry"), read<Address>(env.core, termbookCoreAbi, "reservationManager"),
          read<Address>(env.core, termbookCoreAbi, "integrationRegistry"),
        ]);
        const [policy, active, cash, bundleActive] = await Promise.all([
          read<readonly unknown[]>(registry, houseRegistryAbi, "policies", [operator.house]),
          read<boolean>(registry, houseRegistryAbi, "isActiveHouse", [operator.house, operator.vault]),
          read<bigint>(operator.vault, houseVaultAbi, "availableCash"),
          read<boolean>(integration, integrationRegistryAbi, "isActive", [intent.bundleId]),
        ]);
        const limit = testnetOfferLimit(intent, policy, BigInt(operator.maxLimit), cash);
        if (!active || !bundleActive || limit === undefined || BigInt(operator.aprBps) > BigInt(String(policy[4]))) continue;
        const selected = intent.collateral as { chain: { reference: Hex }; asset: { assetBytes: Hex }; owner: { accountBytes: Hex }; returnRecipient: { accountBytes: Hex }; amount: string } | undefined;
        const market = markets.find((m) => selected ? m.kind === "solana" && m.genesis.toLowerCase() === selected.chain.reference.toLowerCase()
          && m.asset.toLowerCase() === selected.asset.assetBytes.toLowerCase()
          : m.kind === "evm" && m.chainId === intent.chainId && m.asset.toLowerCase() === String(intent.asset).toLowerCase());
        if (!market) continue;
        let identity: SolanaQuoteIdentity | undefined;
        let owner = String(intent.owner ?? intent.borrower) as Address, recipient = String(intent.recipient ?? intent.owner ?? intent.borrower) as Address;
        let asset: Address, vault: Address;
        if (market.kind === "solana" && selected) {
          const row = await read<readonly [Hex, Hex, Hex, Hex, boolean]>(env.core, termbookCoreAbi, "solanaMarkets", [BigInt(market.chainId)]);
          if (!row[4] || row[0] !== market.genesis || row[1] !== market.program || row[2] !== market.asset) continue;
          const verifiers = await read<Address>(env.core, termbookCoreAbi, "verifierRegistry");
          const verifier = await read<readonly [Address, bigint, boolean]>(verifiers, verifierRegistryAbi, "verifiers", [BigInt(market.chainId)]);
          if (!verifier[2]) continue;
          identity = { sourceGenesis: row[0], sourceVault: row[1], sourceAsset: row[2], sourceOwner: selected.owner.accountBytes,
            returnRecipient: selected.returnRecipient.accountBytes, recoveryVault: row[3], verifierVersion: verifier[1] };
          owner = solanaAlias(row[0], identity.sourceOwner); recipient = solanaAlias(row[0], identity.returnRecipient);
          asset = solanaAlias(row[0], row[2]); vault = solanaAlias(row[0], row[1]);
        } else if (market.kind === "evm") { asset = market.asset as Address; vault = market.vault as Address; }
        else continue;
        const marketId = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }], [BigInt(market.chainId), asset, operator.asset as Address]));
        const [risk, oracle, reservationPolicy, policyHash] = await Promise.all([
          read<readonly [Hex, Hex, Hex, number, number, number, bigint, boolean]>(operator.reader, readerAbi, "markets", [marketId]),
          read<Address>(operator.reader, readerAbi, "oracleRegistry"),
          read<readonly unknown[]>(reservation, reservationManagerAbi, "policies", [operator.house, policy[0]]),
          read<Hex>(reservation, reservationManagerAbi, "policyHashes", [operator.house, policy[0]]),
        ]);
        if (!risk[7] || policyHash === zeroHash || String(reservationPolicy[0]).toLowerCase() !== operator.vault.toLowerCase()) continue;
        const price = await read<readonly [bigint, bigint, bigint]>(oracle, oracleRegistryAbi, "read", [risk[0]]);
        const collateralAmount = BigInt(String(selected?.amount ?? intent.amount));
        const sourceValue = collateralAmount * price[0] * 10n ** BigInt(risk[5]) / 10n ** BigInt(risk[4]) / 10n ** 18n;
        const retained = sourceValue * BigInt(risk[3]) / 10_000n;
        if (retained * 10_000n < (limit + risk[6]) * BigInt(String(policy[7]))) continue;
        const setupSeconds = Math.min(operator.setupSeconds, Number(reservationPolicy[1]));
        const now = Number(block.timestamp), expiry = Math.min(Number(intent.expiresAt), now + 300);
        if (setupSeconds < 300 || expiry <= now + 30) continue;
        const setupDeadline = now + setupSeconds;
        const bond = await read<bigint>(reservation, reservationManagerAbi, "minimumBond", [operator.house, policy[0], intent.borrower, limit, BigInt(setupSeconds)]);
        const quote = { intentId: intent.intentId as Hex, borrower: intent.borrower as Address, owner, house: signer.address,
          vault: operator.vault as Address, sourceChain: BigInt(market.chainId), collateralVault: vault, collateralAsset: asset,
          collateralAmount, returnRecipient: recipient, settlementAsset: operator.asset as Address, limit,
          maturity: BigInt(setupDeadline + Number(intent.duration)), revolving: false, bundleId: intent.bundleId as Hex,
          setupDeadline: BigInt(setupDeadline), gracePeriod: 60n, reservationBond: bond, nonce: BigInt(`0x${randomBytes(8).toString("hex")}`),
          expiry: BigInt(expiry), termsHash: keccak256(stringToHex("Termbook testnet House offer v1")), aprBps: BigInt(operator.aprBps),
          originationFee: 0n, commitmentFeeBps: 0n, reservationPolicyHash: policyHash, bondPayer: intent.borrower as Address,
          bondRefundRecipient: intent.borrower as Address, signature: "0x" as Hex };
        const digest = await read<Hex>(env.core, termbookCoreAbi, "quoteDigestFull", [quote]);
        quote.signature = await signer.signMessage({ message: { raw: identity ? solanaQuoteDigest(digest, identity) : digest } });
        const input = quoteSchema.parse(JSON.parse(JSON.stringify({ ...quote, kind: identity ? "solana" : "evm",
          sourceChain: market.chainId, maturity: Number(quote.maturity), setupDeadline, expiry, grace: 60, aprBps: operator.aprBps,
          commitmentFeeBps: 0, domain: env.coreDomain, ...(identity ? { solana: identity } : {}) }, (_, value) => typeof value === "bigint" ? String(value) : value)));
        await quoteService.record(input); count++;
        logger.info("house-offer-issued", { intentId: intent.intentId, house: operator.house, limit: String(limit) });
      } catch (error) { logger.warn("house-offer-unavailable", { intentId: intent.intentId, errorName: error instanceof Error ? error.name : "unknown" }); }
    }
  }
  return count;
}
