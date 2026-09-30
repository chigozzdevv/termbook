import { keccak256, parseTransaction, recoverTransactionAddress, type Hex, type PublicClient, type TransactionSerialized } from "viem";
import { canonicalJson } from "@termbook/schema";
import { keeperRepo } from "./keeper.repo.js";

export async function replaceKeeperTransaction(client: PublicClient, key: string, raw: Hex): Promise<Hex> {
  const match = /^(\d+):(0x[0-9a-f]{40})$/.exec(key);
  if (!match || !/^0x(?:[0-9a-fA-F]{2})+$/.test(raw) || raw.length > 1_000_000
    || await client.getChainId() !== Number(match[1])) throw new Error("keeper-replacement-invalid");
  const claim = await keeperRepo.claim(key);
  if (!claim) throw new Error("keeper-signer-busy");
  try {
    const pending = claim.pending;
    if (!pending || keccak256(pending.raw) !== pending.hash || (pending.previous?.length ?? 0) >= 4) {
      throw new Error("keeper-replacement-invalid");
    }
    const old = parseTransaction(pending.raw), replacement = parseTransaction(raw);
    const frozen = (tx: typeof old) => ({ chainId: tx.chainId, type: tx.type, to: tx.to?.toLowerCase(),
      data: tx.data ?? "0x", value: tx.value ?? 0n, gas: tx.gas, nonce: tx.nonce,
      accessList: "accessList" in tx ? tx.accessList : undefined,
      authorizationList: "authorizationList" in tx ? tx.authorizationList : undefined });
    const [oldSender, sender] = await Promise.all([
      recoverTransactionAddress({ serializedTransaction: pending.raw as TransactionSerialized }),
      recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized }),
    ]);
    if (old.chainId !== Number(match[1]) || old.nonce !== pending.nonce
      || old.to?.toLowerCase() !== pending.to.toLowerCase() || (old.data ?? "0x") !== pending.data
      || oldSender.toLowerCase() !== match[2] || sender.toLowerCase() !== match[2]
      || canonicalJson(frozen(old)) !== canonicalJson(frozen(replacement))) throw new Error("keeper-replacement-authority-mismatch");
    const bump = (fee: bigint) => fee + (fee + 4n) / 5n;
    if ("gasPrice" in old && old.gasPrice !== undefined) {
      if (!("gasPrice" in replacement) || replacement.gasPrice === undefined
        || replacement.gasPrice < bump(old.gasPrice)) throw new Error("keeper-replacement-fee-invalid");
    } else if (!("maxFeePerGas" in old) || old.maxFeePerGas === undefined || old.maxPriorityFeePerGas === undefined
      || !("maxFeePerGas" in replacement) || replacement.maxFeePerGas === undefined
      || replacement.maxPriorityFeePerGas === undefined || replacement.maxFeePerGas < bump(old.maxFeePerGas)
      || replacement.maxPriorityFeePerGas < bump(old.maxPriorityFeePerGas)
      || replacement.maxPriorityFeePerGas > replacement.maxFeePerGas) throw new Error("keeper-replacement-fee-invalid");
    const hash = keccak256(raw);
    await keeperRepo.replaced(key, claim.lease, pending.hash, { ...pending, hash, raw,
      previous: [{ hash: pending.hash, raw: pending.raw }, ...(pending.previous ?? [])] });
    return hash;
  } finally { await keeperRepo.release(key, claim.lease); }
}
