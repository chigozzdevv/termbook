import {
  createWalletClient, encodeAbiParameters, http, keccak256, parseAbi, stringToHex,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { collateralRepo } from "../collateral/collateral.repo.js";
import { env } from "../config/env.js";
import { monadClient } from "./monad.client.js";
import { fetchWormholeVaaById } from "./wormhole-vaa.js";

const targetAbi = parseAbi([
  "function ethereumWormholeCore() view returns (address)",
  "function ethereumAuthorizationPublished(bytes32) view returns (bool)",
  "function ethereumAuthorizationSequenceOf(bytes32) view returns (uint64)",
  "function recoveryVaaPublished(bytes32) view returns (bool)",
  "function recoveryVaaSequenceOf(bytes32) view returns (uint64)",
  "function republishEthereumAuthorization(bytes32,uint8) payable",
  "function republishEthereumRecoveryReturn(bytes32,bytes32) payable",
  "function republishEthereumRecoveryOperation(bytes32) payable",
]);
const wormholeAbi = parseAbi(["function messageFee() view returns (uint256)"]);
const zero = "0x0000000000000000000000000000000000000000";

async function republish(target: Address, functionName:
  "republishEthereumAuthorization" | "republishEthereumRecoveryReturn" | "republishEthereumRecoveryOperation",
args: readonly unknown[], key: Hex): Promise<void> {
  if (!env.monadWormholePublisherKey) throw new Error("monad-wormhole-publisher-unconfigured");
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("monad-wormhole-chain-mismatch");
  const wormhole = await chain.readContract({
    address: target, abi: targetAbi, functionName: "ethereumWormholeCore",
  });
  if (wormhole.toLowerCase() === zero) throw new Error("monad-wormhole-unconfigured");
  const fee = await chain.readContract({ address: wormhole, abi: wormholeAbi, functionName: "messageFee" });
  const account = privateKeyToAccount(env.monadWormholePublisherKey as Hex);
  if (!await collateralRepo.acquireSigner(env.monadChainId, account.address, key)) {
    throw new Error("monad-wormhole-signer-busy");
  }
  try {
    const wallet = createWalletClient({ account, transport: http(env.rpcUrl) });
    const hash = await wallet.writeContract({
      address: target, abi: targetAbi, functionName, args: args as never, value: fee, chain: null,
    });
    const receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error("monad-wormhole-publish-reverted");
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    if (receipt.blockNumber > finalized.number) throw new Error("monad-wormhole-not-finalized");
    const canonical = await chain.getBlock({ blockNumber: receipt.blockNumber });
    if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new Error("monad-wormhole-reorg");
    }
  } finally {
    await collateralRepo.releaseSigner(env.monadChainId, account.address, key);
  }
}

async function current(target: Address, id: Hex, kind: "authorization" | "recovery", payload: Hex) {
  const chain = monadClient();
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  const published = await chain.readContract({
    address: target, abi: targetAbi,
    functionName: kind === "authorization" ? "ethereumAuthorizationPublished" : "recoveryVaaPublished",
    args: [id], blockNumber: finalized.number,
  });
  if (!published) throw new Error("monad-wormhole-message-unpublished");
  const sequence = await chain.readContract({
    address: target, abi: targetAbi,
    functionName: kind === "authorization" ? "ethereumAuthorizationSequenceOf" : "recoveryVaaSequenceOf",
    args: [id], blockNumber: finalized.number,
  });
  return fetchWormholeVaaById({ chain: 48, emitter: target, sequence, payload });
}

export async function currentEthereumAuthorization(input: {
  core: Address; creditId: Hex; actionHash: Hex; kind: 0 | 1; refresh?: boolean; recoveryReturn?: boolean;
}) {
  const payload = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }],
    [keccak256(stringToHex("Termbook Wormhole authorization v1")), keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }],
      [input.creditId, input.actionHash, input.kind],
    ))],
  );
  if (input.refresh) {
    await republish(input.core,
      input.recoveryReturn ? "republishEthereumRecoveryReturn" : "republishEthereumAuthorization",
      input.recoveryReturn ? [input.creditId, input.actionHash] : [input.creditId, input.kind],
      input.actionHash);
  }
  return current(input.core, input.actionHash, "authorization", payload);
}

export async function currentEthereumRecoveryOperation(input: {
  factory: Address; operationId: Hex; digest: Hex; inbox: Address; refresh?: boolean;
}) {
  const eventDigest = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
    [input.operationId, input.digest, input.inbox],
  ));
  const payload = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }],
    [keccak256(stringToHex("Termbook Wormhole recovery operation v1")), eventDigest],
  );
  if (input.refresh) await republish(input.factory, "republishEthereumRecoveryOperation", [input.operationId], input.operationId);
  return current(input.factory, input.operationId, "recovery", payload);
}
