import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { monadClient } from "./monad.client.js";
import { fetchBeaconFinalityUpdate, fetchBeaconUpdate, type prepareBeaconUpdate } from "./ethereum-beacon-proof.js";

const beaconAbi = parseAbi([
  "function chainId() view returns (uint256)",
  "function finalizedSlot() view returns (uint64)",
  "function currentCommitteeRoot() view returns (bytes32)",
  "function nextCommitteeRoot() view returns (bytes32)",
]);
const zeroWord = `0x${"00".repeat(32)}`;
const genesisTime = 1_606_824_023;
const weakSubjectivityWindow = 14 * 86_400;
const pollInterval = 5 * 60_000;
const alertInterval = 60 * 60_000;
type Prepared = ReturnType<typeof prepareBeaconUpdate>;

let running = false;
let lastPoll = 0;
let lastAlert = 0;

export function admissibleBeaconUpdate(
  prepared: Prepared,
  stored: { slot: bigint; currentRoot: Hex; nextRoot: Hex },
): boolean {
  const storedPeriod = stored.slot / 8192n;
  const finalizedPeriod = prepared.finalizedSlot / 8192n;
  const attestedPeriod = prepared.attestedSlot / 8192n;
  const signaturePeriod = prepared.signatureSlot / 8192n;
  if (signaturePeriod < storedPeriod || signaturePeriod > storedPeriod + 1n) return false;
  const signer = signaturePeriod === storedPeriod ? stored.currentRoot : stored.nextRoot;
  if (signer === zeroWord || prepared.signerCommitteeRoot.toLowerCase() !== signer.toLowerCase()) return false;
  if (prepared.finalizedSlot <= stored.slot) {
    return stored.nextRoot === zeroWord && prepared.nextCommitteeRoot !== zeroWord
      && finalizedPeriod === storedPeriod && attestedPeriod === storedPeriod
      && signaturePeriod === storedPeriod;
  }
  return finalizedPeriod >= storedPeriod && finalizedPeriod <= storedPeriod + 1n;
}

async function nextUpdate(input: {
  beaconApiUrl: string;
  stored: { slot: bigint; currentRoot: Hex; nextRoot: Hex };
}): Promise<Prepared> {
  const signerRoots = { storedPeriod: input.stored.slot / 8192n,
    currentRoot: input.stored.currentRoot, nextRoot: input.stored.nextRoot };
  try {
    const latest = await fetchBeaconFinalityUpdate({ beaconApiUrl: input.beaconApiUrl, signerRoots });
    if (admissibleBeaconUpdate(latest, input.stored)) return latest;
  } catch (error) {
    logger.warn("ethereum-beacon-finality-fetch-failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
  const periodic = await fetchBeaconUpdate({ beaconApiUrl: input.beaconApiUrl,
    startPeriod: input.stored.slot / 8192n, signerRoots });
  if (!admissibleBeaconUpdate(periodic, input.stored)) throw new Error("ethereum-beacon-update-unavailable");
  return periodic;
}

async function relay(): Promise<number> {
  const beaconApiUrl = process.env["ETHEREUM_BEACON_API_URL"]!;
  const beaconClient = process.env["ETHEREUM_LIGHT_CLIENT_ADDRESS"] as Address;
  const account = privateKeyToAccount(process.env["ETHEREUM_BEACON_KEEPER_KEY"] as Hex);
  const chain = monadClient();
  if (env.monadChainId !== 143 || await chain.getChainId() !== 143) {
    throw new Error("ethereum-beacon-monad-chain-mismatch");
  }
  const finalizedBlock = await chain.getBlock({ blockTag: "finalized" });
  const [sourceChain, slot, currentRoot, nextRoot] = await Promise.all([
    chain.readContract({ address: beaconClient, abi: beaconAbi, functionName: "chainId",
      blockNumber: finalizedBlock.number }),
    chain.readContract({ address: beaconClient, abi: beaconAbi, functionName: "finalizedSlot",
      blockNumber: finalizedBlock.number }),
    chain.readContract({ address: beaconClient, abi: beaconAbi, functionName: "currentCommitteeRoot",
      blockNumber: finalizedBlock.number }),
    chain.readContract({ address: beaconClient, abi: beaconAbi, functionName: "nextCommitteeRoot",
      blockNumber: finalizedBlock.number }),
  ]);
  if (sourceChain !== 1n || currentRoot === zeroWord || slot === 0n) {
    throw new Error("ethereum-beacon-client-invalid");
  }
  const age = Number(finalizedBlock.timestamp) - (genesisTime + Number(slot) * 12);
  if (age > 12 * 86_400 && Date.now() - lastAlert >= alertInterval) {
    logger.warn("ethereum-beacon-checkpoint-stale", { finalizedSlot: slot.toString(), ageSeconds: age });
    lastAlert = Date.now();
  }
  if (age > weakSubjectivityWindow) throw new Error("ethereum-beacon-checkpoint-expired");
  const pendingNonce = await chain.getTransactionCount({ address: account.address, blockTag: "pending" });
  const finalizedNonce = await chain.getTransactionCount({ address: account.address, blockTag: "finalized" });
  if (pendingNonce !== finalizedNonce) return 0;
  const prepared = await nextUpdate({ beaconApiUrl,
    stored: { slot, currentRoot, nextRoot } });
  await chain.call({ account: account.address, to: beaconClient, data: prepared.calldata });
  const wallet = createWalletClient({ account, transport: http(env.rpcUrl) });
  const hash = await wallet.sendTransaction({ account, chain: null, to: beaconClient,
    data: prepared.calldata, nonce: pendingNonce });
  const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("ethereum-beacon-update-reverted");
  logger.info("ethereum-beacon-update-submitted", {
    transaction: hash, finalizedSlot: prepared.finalizedSlot.toString(),
  });
  return 1;
}

export async function runEthereumBeaconWorker(): Promise<number> {
  if (!process.env["ETHEREUM_LIGHT_CLIENT_ADDRESS"]) return 0;
  if (running || Date.now() - lastPoll < pollInterval) return 0;
  running = true;
  lastPoll = Date.now();
  try { return await relay(); } finally { running = false; }
}
