import "dotenv/config";
import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../src/config/env.js";
import { monadClient } from "../src/chain/monad.client.js";
import { fetchFinalizedBeaconBlock } from "../src/chain/ethereum-beacon-proof.js";

const [slotText, checkpointRoot] = process.argv.slice(2);
const beaconApiUrl = process.env["ETHEREUM_BEACON_API_URL"];
const proofUrl = process.env["ETHEREUM_BEACON_PROOF_URL"];
const beaconClient = process.env["ETHEREUM_LIGHT_CLIENT_ADDRESS"];
const keeperKey = process.env["ETHEREUM_BEACON_KEEPER_KEY"];
if (!/^[1-9][0-9]*$/.test(slotText ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(checkpointRoot ?? "")
  || !beaconApiUrl || !proofUrl || !/^0x[0-9a-fA-F]{40}$/.test(beaconClient ?? "")
  || !/^0x[0-9a-fA-F]{64}$/.test(keeperKey ?? "")) {
  throw new Error("Usage: ETHEREUM_BEACON_API_URL=... ETHEREUM_BEACON_PROOF_URL=... ETHEREUM_LIGHT_CLIENT_ADDRESS=... ETHEREUM_BEACON_KEEPER_KEY=... node --import tsx server/scripts/relay-ethereum-beacon-block.ts <slot> <checkpoint-root>");
}
if (env.monadChainId !== 143) throw new Error("ethereum-beacon-monad-chain-mismatch");
const chain = monadClient();
if (await chain.getChainId() !== 143) throw new Error("ethereum-beacon-monad-chain-mismatch");
const prepared = await fetchFinalizedBeaconBlock({ beaconApiUrl, proofUrl,
  beaconClient: beaconClient as Address, checkpointRoot: checkpointRoot as Hex,
  targetSlot: BigInt(slotText!) });
const keeper = privateKeyToAccount(keeperKey as Hex);
const pendingNonce = await chain.getTransactionCount({ address: keeper.address, blockTag: "pending" });
const finalizedNonce = await chain.getTransactionCount({ address: keeper.address, blockTag: "finalized" });
if (pendingNonce !== finalizedNonce) throw new Error("ethereum-beacon-keeper-pending");
await chain.call({ account: keeper.address, to: beaconClient as Address, data: prepared.calldata });
const wallet = createWalletClient({ account: keeper, transport: http(env.rpcUrl) });
const hash = await wallet.sendTransaction({ account: keeper, chain: null,
  to: beaconClient as Address, data: prepared.calldata, nonce: pendingNonce });
const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60_000 });
if (receipt.status !== "success") throw new Error("ethereum-beacon-historical-reverted");
let finalized = await chain.getBlock({ blockTag: "finalized" });
for (let attempt = 0; receipt.blockNumber > finalized.number && attempt < 60; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  finalized = await chain.getBlock({ blockTag: "finalized" });
}
if (receipt.blockNumber > finalized.number) throw new Error("ethereum-beacon-historical-not-finalized");
const canonical = await chain.getBlock({ blockNumber: receipt.blockNumber });
if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
  throw new Error("ethereum-beacon-historical-reorged");
}
const recordAbi = parseAbi(["function finalizedExecution(bytes32) view returns (bytes32,uint64)"]);
const [executionBlockHash, recordedSlot] = await chain.readContract({ address: beaconClient as Address,
  abi: recordAbi, functionName: "finalizedExecution", args: [prepared.beaconRoot], blockNumber: finalized.number });
if (executionBlockHash.toLowerCase() !== prepared.executionBlockHash.toLowerCase()
  || recordedSlot !== prepared.slot) throw new Error("ethereum-beacon-historical-not-recorded");
console.log(JSON.stringify({ transaction: hash, slot: prepared.slot.toString(),
  beaconRoot: prepared.beaconRoot, executionBlockHash: prepared.executionBlockHash }));
