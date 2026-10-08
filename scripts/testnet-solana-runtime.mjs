import fs from "node:fs";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { createRequire } from "node:module";
import { SolanaRpcWallet } from "../packages/sdk/dist/index.js";
import { root } from "./testnet-runtime.mjs";

const require = createRequire(new URL("../packages/sdk/package.json", import.meta.url));
export const { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction } = require("@solana/web3.js");
export const solanaConnection = () => new Connection("https://api.devnet.solana.com", "finalized");
export const solanaPayer = () => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${root}/.testnet/solana.json`))));

export function journaledSolanaWallet(connection, payer, report, persist, upgradeAuthority) {
  return new SolanaRpcWallet({ publicKey: payer.publicKey,
    signTransaction: async (transaction) => {
      if (transaction instanceof VersionedTransaction) transaction.sign([payer]);
      else transaction.partialSign(payer);
      return transaction;
    } },
  connection, payer.publicKey.toBase58(), {
    network: "Testnet", testnetUpgradeAuthority: upgradeAuthority,
    sendSigned: async (signed) => {
      report.solanaTransactions ??= [];
      let tx = report.solanaTransactions.find((entry) => entry.signature === signed.signature);
      if (!tx) {
        tx = { signature: signed.signature, rawTransaction: Buffer.from(signed.raw).toString("base64"),
          blockhash: signed.blockhash, lastValidBlockHeight: signed.lastValidBlockHeight, status: "prepared" };
        report.solanaTransactions.push(tx); persist();
      }
      let status = (await connection.getSignatureStatuses([tx.signature], { searchTransactionHistory: true })).value[0];
      if (!status) {
        if (await connection.getBlockHeight("finalized") > tx.lastValidBlockHeight) throw new Error("Solana signed transaction expired; reconcile before resuming");
        const sent = await connection.sendRawTransaction(Buffer.from(tx.rawTransaction, "base64"), { skipPreflight: false, maxRetries: 2 });
        if (sent !== tx.signature) throw new Error("Solana transaction signature mismatch");
      }
      await connection.confirmTransaction({ signature: tx.signature, blockhash: tx.blockhash,
        lastValidBlockHeight: tx.lastValidBlockHeight }, "finalized");
      status = (await connection.getSignatureStatuses([tx.signature], { searchTransactionHistory: true })).value[0];
      if (!status || status.err || status.confirmationStatus !== "finalized") throw new Error("Solana transaction failed");
      const canonical = await connection.getTransaction(tx.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      if (!canonical || canonical.meta?.err || canonical.slot !== status.slot) throw new Error("Solana receipt mismatch");
      Object.assign(tx, { status: "success", slot: status.slot, timestamp: canonical.blockTime, fee: canonical.meta.fee }); persist();
      return tx.signature;
    },
  });
}

export const publicSolanaTransactions = (report) => (report.solanaTransactions ?? []).map(({ rawTransaction: _raw, ...tx }) => tx);
