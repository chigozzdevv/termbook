import { randomBytes } from "node:crypto";
import { quoteRepo } from "./quote.repo.js";
import { constants } from "../config/constants.js";
import { intentRepo } from "../intent/intent.repo.js";
import { env } from "../config/env.js";
import { encodeAbiParameters, keccak256, recoverAddress, recoverMessageAddress } from "viem";

async function recoverQuoteSigner(digest: `0x${string}`, signature: `0x${string}`): Promise<string | undefined> {
  try {
    return await recoverAddress({ hash: digest, signature });
  } catch {
    return undefined;
  }
}

async function recoverPersonalSigner(digest: `0x${string}`, signature: `0x${string}`): Promise<string | undefined> {
  try {
    return await recoverMessageAddress({ message: { raw: digest }, signature });
  } catch {
    return undefined;
  }
}

export const quoteService = {
  async offers(intentId: string) {
    const intent = await intentRepo.get(intentId);
    if (!intent || intent["used"] === true || Number(intent["expiresAt"] ?? 0) < Math.floor(Date.now() / 1000)) return [];
    const rows = await quoteRepo.list(intentId);
    return rows.slice(0, constants.maxOffers).map((row) => ({ ...row, id: row.quoteId }));
  },
  async record(input: Record<string, unknown>) {
    const intentId = input["intentId"];
    const intent = typeof intentId === "string" ? await intentRepo.get(intentId) : null;
    if (typeof intentId !== "string" || !intent) throw new Error("intent-not-found");
    const now = Math.floor(Date.now() / 1000);
    if (Number(input["expiry"] ?? 0) <= now || Number(input["expiry"] ?? 0) > Number(intent["expiresAt"] ?? 0)) throw new Error("offer-expired");
    if (String(input["borrower"]).toLowerCase() !== String(intent["borrower"]).toLowerCase()) throw new Error("quote-borrower-mismatch");
    if (input["sourceChain"] !== undefined && Number(input["sourceChain"]) !== Number(intent["chainId"])) throw new Error("quote-collateral-mismatch");
    if (input["collateralAsset"] !== undefined && String(input["collateralAsset"]).toLowerCase() !== String(intent["asset"]).toLowerCase()) throw new Error("quote-collateral-mismatch");
    if (input["collateralAmount"] !== undefined && BigInt(String(input["collateralAmount"])) !== BigInt(String(intent["amount"]))) throw new Error("quote-collateral-mismatch");
    const domain = String(input["domain"] ?? env.coreDomain);
    if (!/^0x[a-fA-F0-9]{64}$/.test(domain)) throw new Error("quote-domain-required");
    if (env.coreDomain && domain.toLowerCase() !== env.coreDomain.toLowerCase()) throw new Error("quote-domain-mismatch");
    const asAddress = (value: unknown) => String(value) as `0x${string}`;
    const asBytes32 = (value: unknown) => String(value) as `0x${string}`;
    const aprBps = BigInt(Number(input["aprBps"] ?? 0));
    const originationFee = BigInt(String(input["originationFee"] ?? "0"));
    const commitmentFeeBps = BigInt(Number(input["commitmentFeeBps"] ?? 0));
    const full = input["owner"] !== undefined && input["sourceChain"] !== undefined && input["collateralVault"] !== undefined && input["collateralAsset"] !== undefined && input["collateralAmount"] !== undefined && input["returnRecipient"] !== undefined && input["settlementAsset"] !== undefined;
    const terms = aprBps !== 0n || originationFee !== 0n || commitmentFeeBps !== 0n;
    const digest = keccak256(encodeAbiParameters(
      full
        ? [
            { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
            { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" },
            { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address" },
            { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32" },
            { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
            { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
          ]
        : terms
        ? [
            { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
            { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" },
            { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
            { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
          ]
        : [
            { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
            { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" },
            { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
            { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
          ],
      full
        ? [
            asBytes32(domain), asBytes32(input["intentId"]), asAddress(input["borrower"]), asAddress(input["owner"]), asAddress(input["house"]), asAddress(input["vault"]), BigInt(String(input["sourceChain"])), asAddress(input["collateralVault"]), asAddress(input["collateralAsset"]), BigInt(String(input["collateralAmount"])), asAddress(input["returnRecipient"]), asAddress(input["settlementAsset"]), BigInt(String(input["limit"])), BigInt(String(input["maturity"])), Boolean(input["revolving"]), asBytes32(input["bundleId"]), BigInt(String(input["setupDeadline"])), BigInt(String(input["grace"])), BigInt(String(input["reservationBond"] ?? "0")), BigInt(String(input["nonce"])), BigInt(String(input["expiry"])), asBytes32(input["termsHash"]), aprBps, originationFee, commitmentFeeBps,
          ]
        : terms
        ? [
            asBytes32(domain), asBytes32(input["intentId"]), asAddress(input["borrower"]), asAddress(input["house"]), asAddress(input["vault"]), BigInt(String(input["limit"])), BigInt(String(input["maturity"])), Boolean(input["revolving"]), asBytes32(input["bundleId"]), BigInt(String(input["setupDeadline"])), BigInt(String(input["grace"])), BigInt(String(input["reservationBond"] ?? "0")), BigInt(String(input["nonce"])), BigInt(String(input["expiry"])), asBytes32(input["termsHash"]), aprBps, originationFee, commitmentFeeBps,
          ]
        : [
            asBytes32(domain), asBytes32(input["intentId"]), asAddress(input["borrower"]), asAddress(input["house"]), asAddress(input["vault"]), BigInt(String(input["limit"])), BigInt(String(input["maturity"])), Boolean(input["revolving"]), asBytes32(input["bundleId"]), BigInt(String(input["setupDeadline"])), BigInt(String(input["grace"])), BigInt(String(input["reservationBond"] ?? "0")), BigInt(String(input["nonce"])), BigInt(String(input["expiry"])), asBytes32(input["termsHash"]),
          ],
    ));
    const signature = String(input["signature"]) as `0x${string}`;
    let signer = await recoverQuoteSigner(digest, signature);
    if (signer?.toLowerCase() !== String(input["house"]).toLowerCase()) {
      signer = await recoverPersonalSigner(digest, signature);
    }
    if (signer?.toLowerCase() !== String(input["house"]).toLowerCase()) throw new Error("quote-signature-invalid");
    const quoteId = `q_${randomBytes(8).toString("hex")}`;
    return quoteRepo.save({ quoteId, ...input, domain });
  },
};
