import { randomBytes } from "node:crypto";
import { quoteRepo } from "./quote.repo.js";
import { constants } from "../config/constants.js";
import { intentRepo } from "../intent/intent.repo.js";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { encodeAbiParameters, keccak256 } from "viem";
import { matchesSolanaAliases, solanaQuoteDigest, type SolanaQuoteIdentity } from "./solana.js";
import { rankQuotes } from "./rank.js";
import { houseRepo } from "../house/house.repo.js";
import { verifyHouseSignature } from "./signature.js";

const solanaMarketAbi = [{ type: "function", name: "solanaMarkets", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bool" }] }] as const;
const coreHouseAbi = [{ type: "function", name: "houseRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const houseRegistryAbi = [{ type: "function", name: "isActiveHouse", stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] }] as const;
const housePolicyAbi = [{ type: "function", name: "policies", stateMutability: "view",
  inputs: [{ type: "address" }], outputs: [
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    { type: "bool" }, { type: "bool" },
  ] }] as const;
const vaultAssetAbi = [{ type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

async function houseAdmission(quote: Record<string, unknown>) {
  const house = String(quote["house"]);
  const vault = String(quote["vault"]);
  const asset = String(quote["settlementAsset"]);
  const registered = await houseRepo.get(house);
  if (!registered || String(registered.vault).toLowerCase() !== vault.toLowerCase()
    || String(registered.asset).toLowerCase() !== asset.toLowerCase()) return null;
  const chain = monadClient();
  const block = await chain.getBlock({ blockTag: "finalized" });
  const registry = await chain.readContract({ address: env.core as `0x${string}`,
    abi: coreHouseAbi, functionName: "houseRegistry", blockNumber: block.number });
  if (!/^0x[a-fA-F0-9]{40}$/.test(registry) || /^0x0{40}$/i.test(registry)) return null;
  const [active, vaultAsset, policy] = await Promise.all([
    chain.readContract({ address: registry, abi: houseRegistryAbi, functionName: "isActiveHouse",
      args: [house as `0x${string}`, vault as `0x${string}`], blockNumber: block.number }),
    chain.readContract({ address: vault as `0x${string}`, abi: vaultAssetAbi,
      functionName: "asset", blockNumber: block.number }),
    chain.readContract({ address: registry, abi: housePolicyAbi, functionName: "policies",
      args: [house as `0x${string}`], blockNumber: block.number }),
  ]);
  const limit = BigInt(String(quote["limit"]));
  const fee = BigInt(String(quote["originationFee"] ?? "0"));
  const maturity = BigInt(String(quote["maturity"]));
  const setupDeadline = BigInt(String(quote["setupDeadline"]));
  const apr = BigInt(String(quote["aprBps"]));
  const commitment = BigInt(String(quote["commitmentFeeBps"] ?? 0));
  const tenor = maturity - setupDeadline;
  if (!active || vaultAsset.toLowerCase() !== asset.toLowerCase() || !policy[12] || !policy[13]
    || limit > policy[1] || tenor < policy[2] || tenor > policy[3] || apr > policy[4]
    || fee * 10_000n > limit * policy[5] || commitment > policy[6]) return null;
  return { policyVersion: policy[0].toString(), initialBps: policy[7].toString(),
    maintenanceBps: policy[8].toString(), watchBps: policy[9].toString(),
    freezeBps: policy[10].toString(), liquidationBps: policy[11].toString() };
}

export const quoteService = {
  async offers(intentId: string) {
    const intent = await intentRepo.get(intentId);
    if (!intent || intent["used"] === true || Number(intent["expiresAt"] ?? 0) <= Math.floor(Date.now() / 1000)) return [];
    const rows = await quoteRepo.list(intentId);
    const candidates: Record<string, unknown>[] = rankQuotes(intent, rows);
    const admitted = await Promise.all(candidates.map(async (offer) => {
      try {
        return await houseAdmission(offer);
      } catch {
        return null;
      }
    }));
    return candidates.flatMap((offer, index) => admitted[index]
      ? [{ ...offer, riskTerms: admitted[index] }] : []).slice(0, constants.maxOffers);
  },
  async record(input: Record<string, unknown>) {
    const intentId = input["intentId"];
    const intent = typeof intentId === "string" ? await intentRepo.get(intentId) : null;
    if (typeof intentId !== "string" || !intent) throw new Error("intent-not-found");
    const now = Math.floor(Date.now() / 1000);
    if (intent["used"] === true || Number(intent["expiresAt"] ?? 0) <= now) throw new Error("intent-expired");
    if (Number(input["expiry"] ?? 0) <= now || Number(input["expiry"] ?? 0) > Number(intent["expiresAt"] ?? 0)) throw new Error("offer-expired");
    if (Number(input["setupDeadline"]) <= now
      || Number(input["maturity"]) < Number(input["setupDeadline"]) + Number(intent["duration"])) {
      throw new Error("quote-duration-insufficient");
    }
    if (String(input["borrower"]).toLowerCase() !== String(intent["borrower"]).toLowerCase()) throw new Error("quote-borrower-mismatch");
    if (intent["bundleId"] && String(input["bundleId"]).toLowerCase() !== String(intent["bundleId"]).toLowerCase()) throw new Error("quote-bundle-mismatch");
    if (!intent["settlementAsset"] || String(input["settlementAsset"]).toLowerCase() !== String(intent["settlementAsset"]).toLowerCase()) {
      throw new Error("quote-settlement-asset-mismatch");
    }
    if (!await houseAdmission(input)) {
      throw new Error("house-unavailable");
    }
    const limit = BigInt(String(input["limit"]));
    if (intent["limit"] && limit > BigInt(String(intent["limit"]))) throw new Error("quote-limit-exceeds-cap");
    if (limit < BigInt(String(intent["actionFunding"] ?? "0")) + BigInt(String(input["originationFee"] ?? "0"))) {
      throw new Error("quote-action-funding-insufficient");
    }
    let solana: SolanaQuoteIdentity | undefined;
    if (input["kind"] === "solana") {
      const source = input["solana"] as Record<string, unknown> | undefined;
      const requested = intent["collateral"] as Record<string, unknown> | undefined;
      if (!source || !requested || !input["sourceChain"] || !input["collateralAmount"]) throw new Error("quote-collateral-mismatch");
      const chain = requested["chain"] as Record<string, unknown> | undefined;
      const asset = requested["asset"] as Record<string, unknown> | undefined;
      const owner = requested["owner"] as Record<string, unknown> | undefined;
      const recipient = requested["returnRecipient"] as Record<string, unknown> | undefined;
      const genesis = String(source["sourceGenesis"]).toLowerCase() as `0x${string}`;
      const sourceAsset = String(source["sourceAsset"]).toLowerCase() as `0x${string}`;
      const sourceOwner = String(source["sourceOwner"]).toLowerCase() as `0x${string}`;
      const sourceRecipient = String(source["returnRecipient"]).toLowerCase() as `0x${string}`;
      if (chain?.["namespace"] !== "solana" || String(chain["reference"]).toLowerCase() !== genesis
        || asset?.["namespace"] !== "solana" || asset["kind"] !== "native"
        || owner?.["namespace"] !== "solana" || recipient?.["namespace"] !== "solana"
        || String(asset?.["assetBytes"]).toLowerCase() !== sourceAsset
        || String(owner?.["accountBytes"]).toLowerCase() !== sourceOwner
        || String(recipient?.["accountBytes"]).toLowerCase() !== sourceRecipient
        || BigInt(String(requested["amount"])) !== BigInt(String(input["collateralAmount"]))) throw new Error("quote-collateral-mismatch");
      solana = {
        sourceGenesis: genesis,
        sourceVault: String(source["sourceVault"]) as `0x${string}`,
        sourceAsset,
        sourceOwner,
        returnRecipient: sourceRecipient,
        recoveryVault: String(source["recoveryVault"]) as `0x${string}`,
        verifierVersion: BigInt(String(source["verifierVersion"])),
      };
      if (!matchesSolanaAliases({
        owner: String(input["owner"]), collateralVault: String(input["collateralVault"]),
        collateralAsset: String(input["collateralAsset"]), returnRecipient: String(input["returnRecipient"]),
      }, solana)) throw new Error("quote-solana-alias-mismatch");
      const market = await monadClient().readContract({
        address: env.core as `0x${string}`,
        abi: solanaMarketAbi,
        functionName: "solanaMarkets",
        args: [BigInt(String(input["sourceChain"]))],
      });
      if (!market[4] || market[0].toLowerCase() !== genesis || market[1].toLowerCase() !== String(source["sourceVault"]).toLowerCase()
        || market[2].toLowerCase() !== sourceAsset || market[3].toLowerCase() !== String(source["recoveryVault"]).toLowerCase()) throw new Error("quote-solana-market-mismatch");
    } else {
      if (intent["collateral"]) throw new Error("quote-collateral-mismatch");
      if (Number(input["sourceChain"]) !== Number(intent["chainId"])) throw new Error("quote-collateral-mismatch");
      if (String(input["collateralAsset"]).toLowerCase() !== String(intent["asset"]).toLowerCase()) throw new Error("quote-collateral-mismatch");
      if (BigInt(String(input["collateralAmount"])) !== BigInt(String(intent["amount"]))) throw new Error("quote-collateral-mismatch");
      if (String(input["owner"]).toLowerCase() !== String(intent["owner"] ?? intent["borrower"]).toLowerCase()
        || String(input["returnRecipient"]).toLowerCase() !== String(intent["recipient"] ?? intent["owner"] ?? intent["borrower"]).toLowerCase()) {
        throw new Error("quote-collateral-mismatch");
      }
    }
    const domain = String(input["domain"] ?? env.coreDomain);
    if (!/^0x[a-fA-F0-9]{64}$/.test(domain)) throw new Error("quote-domain-required");
    if (env.coreDomain && domain.toLowerCase() !== env.coreDomain.toLowerCase()) throw new Error("quote-domain-mismatch");
    const asAddress = (value: unknown) => String(value) as `0x${string}`;
    const asBytes32 = (value: unknown) => String(value) as `0x${string}`;
    const aprBps = BigInt(Number(input["aprBps"] ?? 0));
    const originationFee = BigInt(String(input["originationFee"] ?? "0"));
    const commitmentFeeBps = BigInt(Number(input["commitmentFeeBps"] ?? 0));
    const full = input["owner"] !== undefined && input["sourceChain"] !== undefined && input["collateralVault"] !== undefined && input["collateralAsset"] !== undefined && input["collateralAmount"] !== undefined && input["returnRecipient"] !== undefined && input["settlementAsset"] !== undefined;
    if (!full) throw new Error("complete-collateral-binding-required");
    const digest = keccak256(encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
        { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" },
        { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address" },
        { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
      ],
      [
        asBytes32(domain), asBytes32(input["intentId"]), asAddress(input["borrower"]),
        asAddress(input["owner"]), asAddress(input["house"]), asAddress(input["vault"]),
        BigInt(String(input["sourceChain"])), asAddress(input["collateralVault"]),
        asAddress(input["collateralAsset"]), BigInt(String(input["collateralAmount"])),
        asAddress(input["returnRecipient"]), asAddress(input["settlementAsset"]),
        BigInt(String(input["limit"])), BigInt(String(input["maturity"])), Boolean(input["revolving"]),
        asBytes32(input["bundleId"]), BigInt(String(input["setupDeadline"])),
        BigInt(String(input["grace"])), BigInt(String(input["reservationBond"] ?? "0")),
        BigInt(String(input["nonce"])), BigInt(String(input["expiry"])), asBytes32(input["termsHash"]),
        aprBps, originationFee, commitmentFeeBps,
      ],
    ));
    const signature = String(input["signature"]) as `0x${string}`;
    const signedDigest = solana ? solanaQuoteDigest(digest, solana) : digest;
    if (!await verifyHouseSignature(String(input["house"]) as `0x${string}`, signedDigest, signature)) {
      throw new Error("quote-signature-invalid");
    }
    const quoteId = `q_${randomBytes(8).toString("hex")}`;
    return quoteRepo.save({ quoteId, ...input, domain });
  },
};
