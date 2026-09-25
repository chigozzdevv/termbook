import {
  createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseAbi,
  stringToHex, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { collateralRepo } from "../collateral/collateral.repo.js";
import { fetchWormholeVaaById } from "./wormhole-vaa.js";

const verifierAbi = parseAbi([
  "function wormholeMode() pure returns (bool)",
  "function publisher() view returns (address)",
  "function publisherCodeHash() view returns (bytes32)",
  "function proofMaxAge() view returns (uint256)",
]);
const publisherAbi = parseAbi([
  "function vault() view returns (address)",
  "function controller() view returns (address)",
  "function wormhole() view returns (address)",
  "function snapshotKey(uint8,bytes32,uint256) pure returns (bytes32)",
  "function published(bytes32) view returns (bool)",
  "function sequenceOf(bytes32) view returns (uint64)",
  "function snapshotPublishedAt(bytes32) view returns (uint256)",
  "function publishLock(bytes32) payable returns (uint64)",
  "function publishApplied(bytes32) payable returns (uint64)",
  "function publishUnconsumed(bytes32,uint256) payable returns (uint64)",
]);
const wormholeAbi = parseAbi(["function messageFee() view returns (uint256)"]);
const snapshotDomain = keccak256(stringToHex("Termbook Wormhole Ethereum snapshot v1"));

export async function ethereumWormholeMode(verifier: Address): Promise<boolean> {
  try {
    return await createPublicClient({ transport: http(env.rpcUrl) }).readContract({
      address: verifier, abi: verifierAbi, functionName: "wormholeMode",
    });
  } catch {
    return false;
  }
}

export async function fetchEthereumSnapshot(input: {
  verifier: Address;
  vault: Address;
  controller?: Address;
  kind: 1 | 2 | 3;
  digest: Hex;
  deadline?: bigint;
  lockId?: Hex;
}) {
  if (!env.sourceRpcUrl || !env.sourceWormholePublisherKey || !env.wormholeScanUrl) {
    throw new Error("ethereum-wormhole-unconfigured");
  }
  const source = createPublicClient({ transport: http(env.sourceRpcUrl) });
  if (await source.getChainId() !== 1) throw new Error("ethereum-wormhole-chain-mismatch");
  const monad = createPublicClient({ transport: http(env.rpcUrl) });
  const [publisher, expectedCodeHash] = await Promise.all([
    monad.readContract({ address: input.verifier, abi: verifierAbi, functionName: "publisher" }),
    monad.readContract({ address: input.verifier, abi: verifierAbi, functionName: "publisherCodeHash" }),
  ]);
  const [runtime, vault, controller, wormhole] = await Promise.all([
    source.getCode({ address: publisher }),
    source.readContract({ address: publisher, abi: publisherAbi, functionName: "vault" }),
    source.readContract({ address: publisher, abi: publisherAbi, functionName: "controller" }),
    source.readContract({ address: publisher, abi: publisherAbi, functionName: "wormhole" }),
  ]);
  if (!runtime || keccak256(runtime).toLowerCase() !== expectedCodeHash.toLowerCase()
    || vault.toLowerCase() !== input.vault.toLowerCase()
    || (input.controller && controller.toLowerCase() !== input.controller.toLowerCase())) {
    throw new Error("ethereum-wormhole-publisher-mismatch");
  }
  const deadline = input.deadline ?? 0n;
  const key = keccak256(encodeAbiParameters(
    [{ type: "uint8" }, { type: "bytes32" }, { type: "uint256" }],
    [input.kind, input.digest, deadline],
  ));
  let finalized = await source.getBlock({ blockTag: "finalized" });
  const [exists, publishedAt, maxAge] = await Promise.all([
    source.readContract({
      address: publisher, abi: publisherAbi, functionName: "published", args: [key], blockNumber: finalized.number,
    }),
    source.readContract({
      address: publisher, abi: publisherAbi, functionName: "snapshotPublishedAt", args: [key], blockNumber: finalized.number,
    }),
    monad.readContract({ address: input.verifier, abi: verifierAbi, functionName: "proofMaxAge" }),
  ]);
  if (maxAge < 7200n) throw new Error("ethereum-wormhole-proof-age-too-short");
  const refresh = !exists || finalized.timestamp - publishedAt >= maxAge / 2n;
  if (refresh) {
    const pendingPublication = await source.readContract({
      address: publisher, abi: publisherAbi, functionName: "published", args: [key],
    });
    const latestPublishedAt = await source.readContract({
      address: publisher, abi: publisherAbi, functionName: "snapshotPublishedAt", args: [key],
    });
    if (pendingPublication && (!exists || latestPublishedAt !== publishedAt)) {
      throw new Error("ethereum-wormhole-not-finalized");
    }
    const account = privateKeyToAccount(env.sourceWormholePublisherKey as Hex);
    if (!await collateralRepo.acquireSigner(1, account.address, key)) {
      throw new Error("ethereum-wormhole-signer-busy");
    }
    try {
      const wallet = createWalletClient({ account, transport: http(env.sourceRpcUrl) });
      const fee = await source.readContract({ address: wormhole, abi: wormholeAbi, functionName: "messageFee" });
      const functionName = input.kind === 1 ? "publishLock"
        : input.kind === 2 ? "publishApplied" : "publishUnconsumed";
      if (input.kind === 1 && !input.lockId) throw new Error("ethereum-wormhole-lock-missing");
      const args = input.kind === 1 ? [input.lockId!] as const
        : input.kind === 2 ? [input.digest] as const : [input.digest, deadline] as const;
      const hash = await wallet.writeContract({
        address: publisher, abi: publisherAbi, functionName, args, value: fee, chain: null,
      });
      const receipt = await source.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("ethereum-wormhole-publish-reverted");
      finalized = await source.getBlock({ blockTag: "finalized" });
      if (receipt.blockNumber > finalized.number) throw new Error("ethereum-wormhole-not-finalized");
      const canonical = await source.getBlock({ blockNumber: receipt.blockNumber });
      if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        throw new Error("ethereum-wormhole-reorg");
      }
      const confirmed = await source.readContract({
        address: publisher, abi: publisherAbi, functionName: "published", args: [key], blockNumber: finalized.number,
      });
      if (!confirmed) throw new Error("ethereum-wormhole-publish-missing");
    } finally {
      await collateralRepo.releaseSigner(1, account.address, key);
    }
  }
  const sequence = await source.readContract({
    address: publisher, abi: publisherAbi, functionName: "sequenceOf", args: [key], blockNumber: finalized.number,
  });
  const payload = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint8" }, { type: "bytes32" }, { type: "uint256" }],
    [snapshotDomain, input.kind, input.digest, deadline],
  );
  const vaa = await fetchWormholeVaaById({ chain: 2, emitter: publisher, sequence, payload });
  return { ...vaa, blockHash: finalized.hash };
}
