import { ethereumSourceChain } from "../chain/networks.js";
import { createPublicClient, encodeAbiParameters, encodeFunctionData, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { z } from "zod";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { currentEthereumAuthorization } from "../chain/monad-wormhole.js";
import { fetchEthereumSnapshot } from "../chain/ethereum-wormhole-snapshot.js";
import { hashRemoteAction, readAuthorizedAction, serializeAction } from "./remote-action.js";
import { verifyAuthorizationReceipt } from "./remote-action.service.js";
import { appliedLogIndex } from "../chain/source-action-receipt.js";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((s) => s.toLowerCase() as Hex);
export const topUpPlanSchema = z.object({ creditId: word, authorizationTxHash: word }).strict();
export const topUpConfirmationSchema = z.object({ creditId: word,
  mode: z.enum(["apply", "expire"]), sourceTx: word.optional() }).strict();
const sourceAbi = parseAbi([
  "function consumed(bytes32) view returns (bool)",
  "function core() view returns (address)", "function vault() view returns (address)",
  "function asset() view returns (address)", "function chainId_() view returns (uint256)",
  "function monadCore() view returns (address)", "function monadChain() view returns (uint256)",
  "function verifier() view returns (address)", "function sourceVault() view returns (address)",
  "function sourceController() view returns (address)", "function sourceControllerCodeHash() view returns (bytes32)",
  "function wormholeMode() pure returns (bool)",
  "function verifyEvent(bytes header,bytes proof,address emitter,bytes32 digest) view returns (bool)",
  "function verifyAppliedAction(bytes header,bytes proof,address vault,bytes32 hash) view returns (bool)",
  "function verifyUnconsumedAction(bytes header,bytes proof,address controller,bytes32 hash,uint256 deadline) view returns (bool)",
  "function execute((uint256 monadChain,address monadCore,uint256 sourceChain,address sourceVault,bytes32 creditId,bytes32 lockId,address asset,uint8 kind,address recipient,uint256 amount,uint256 nonce,uint256 deadline),bytes header,bytes proof)",
]);
const coreAbi = parseAbi(["function confirmCollateralTopUp(bytes32,bytes,bytes)", "function cancelExpiredCollateralTopUp(bytes32,bytes,bytes)"]);
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const zero = "0x0000000000000000000000000000000000000000";

async function verifierBinding(creditId: Hex) {
  const chain = monadClient();
  const at = (await chain.getBlock({ blockTag: "finalized" })).number;
  const credit = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
    functionName: "creditDetails", args: [creditId], blockNumber: at });
  const registry = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
    functionName: "verifierRegistry", blockNumber: at });
  if (registry === zero) throw new Error("source-verifier-unavailable");
  const [verifier, version, active, , hash] = await chain.readContract({ address: registry, abi: verifierRegistryAbi,
    functionName: "verifiers", args: [BigInt(ethereumSourceChain())], blockNumber: at });
  const code = await chain.getCode({ address: verifier, blockNumber: at });
  if (!active || version !== credit.verifierVersion || !equal(hash, credit.verifierCodeHash)
    || !code || !equal(keccak256(code), hash)) throw new Error("source-verifier-mismatch");
  const [vault, controller] = await Promise.all([
    chain.readContract({ address: verifier, abi: sourceAbi, functionName: "sourceVault", blockNumber: at }),
    chain.readContract({ address: verifier, abi: sourceAbi, functionName: "sourceController", blockNumber: at }),
  ]);
  if (!equal(vault, credit.collateralVault) || controller === zero) throw new Error("source-controller-mismatch");
  return { chain, verifier, controller };
}

export const topUpService = {
  async plan(input: z.infer<typeof topUpPlanSchema>, requester: Address) {
    if (!env.sourceRpcUrl || !env.wormholeScanUrl) throw new Error("source-proof-unavailable");
    const { action, actionHash } = await readAuthorizedAction(input.creditId, 2, requester, true);
    await verifyAuthorizationReceipt(input.creditId, actionHash, 2, input.authorizationTxHash);
    const { chain, controller, verifier: pinnedVerifier } = await verifierBinding(input.creditId);
    const source = createPublicClient({ transport: http(env.sourceRpcUrl) });
    if (await source.getChainId() !== ethereumSourceChain()) throw new Error("source-action-chain-mismatch");
    const pinnedHash = await chain.readContract({ address: pinnedVerifier, abi: sourceAbi, functionName: "sourceControllerCodeHash" });
    const code = await source.getCode({ address: controller, blockTag: "finalized" });
    if (!code || !equal(keccak256(code), pinnedHash)) throw new Error("source-controller-code-mismatch");
    const consumed = await source.readContract({ address: controller, abi: sourceAbi, functionName: "consumed", args: [actionHash], blockTag: "finalized" });
    const at = (await source.getBlock({ blockTag: "finalized" })).number;
    const [core, asset, sourceChain, vault, monadCore, monadChain, verifier] = await Promise.all([
      source.readContract({ address: action.sourceVault, abi: sourceAbi, functionName: "core", blockNumber: at }),
      source.readContract({ address: action.sourceVault, abi: sourceAbi, functionName: "asset", blockNumber: at }),
      source.readContract({ address: action.sourceVault, abi: sourceAbi, functionName: "chainId_", blockNumber: at }),
      source.readContract({ address: controller, abi: sourceAbi, functionName: "vault", blockNumber: at }),
      source.readContract({ address: controller, abi: sourceAbi, functionName: "monadCore", blockNumber: at }),
      source.readContract({ address: controller, abi: sourceAbi, functionName: "monadChain", blockNumber: at }),
      source.readContract({ address: controller, abi: sourceAbi, functionName: "verifier", blockNumber: at }),
    ]);
    if (!equal(core, controller) || !equal(vault, action.sourceVault) || !equal(asset, action.asset)
      || sourceChain !== BigInt(ethereumSourceChain()) || !equal(monadCore, action.monadCore) || monadChain !== action.monadChain
      || !await source.readContract({ address: verifier, abi: sourceAbi, functionName: "wormholeMode", blockNumber: at })) {
      throw new Error("source-controller-mismatch");
    }
    const authorization = await currentEthereumAuthorization({ core: action.monadCore, creditId: action.creditId, actionHash, kind: 2 });
    const digest = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }], [action.creditId, actionHash, 2]));
    if (!await source.readContract({ address: verifier, abi: sourceAbi, functionName: "verifyEvent",
      args: [authorization.header, authorization.proof, action.monadCore, digest] })) throw new Error("remote-action-proof-rejected");
    return { consumed, action: serializeAction(action), actionHash: hashRemoteAction(action), authorizationTxHash: input.authorizationTxHash,
      controller, header: authorization.header, proof: authorization.proof,
      transaction: { to: controller, data: encodeFunctionData({ abi: sourceAbi, functionName: "execute",
        args: [action, authorization.header, authorization.proof] }) } };
  },
  async confirmation(input: z.infer<typeof topUpConfirmationSchema>, requester: Address) {
    if (!env.sourceRpcUrl || !env.wormholeScanUrl || !env.sourceWormholePublisherKey) throw new Error("source-proof-unavailable");
    const { action, actionHash } = await readAuthorizedAction(input.creditId, 2, requester, true);
    const { chain, verifier, controller } = await verifierBinding(input.creditId);
    if (input.mode === "apply") {
      const source = createPublicClient({ transport: http(env.sourceRpcUrl) });
      if (await source.getChainId() !== ethereumSourceChain()) throw new Error("source-action-chain-mismatch");
      if (!await source.readContract({ address: controller, abi: sourceAbi, functionName: "consumed", args: [actionHash], blockTag: "finalized" })) throw new Error("source-action-not-applied");
      if (input.sourceTx) {
      const receipt = await source.getTransactionReceipt({ hash: input.sourceTx });
      const finalized = await source.getBlock({ blockTag: "finalized" });
      const block = await source.getBlock({ blockNumber: receipt.blockNumber });
      if (receipt.blockNumber > finalized.number || !equal(block.hash, receipt.blockHash)
        || !equal(block.transactions[receipt.transactionIndex]!, input.sourceTx)) throw new Error("source-action-not-finalized");
      appliedLogIndex(receipt, { vault: action.sourceVault, actionHash, lockId: action.lockId,
        recipient: action.recipient, amount: action.amount, kind: 2 });
      }
    }
    const proof = await fetchEthereumSnapshot({ verifier, vault: action.sourceVault, controller,
      kind: input.mode === "apply" ? 2 : 3, digest: actionHash, deadline: action.deadline });
    const verified = input.mode === "apply"
      ? await chain.readContract({ address: verifier, abi: sourceAbi, functionName: "verifyAppliedAction", args: [proof.header, proof.proof, action.sourceVault, actionHash] })
      : await chain.readContract({ address: verifier, abi: sourceAbi, functionName: "verifyUnconsumedAction", args: [proof.header, proof.proof, controller, actionHash, action.deadline] });
    if (!verified) throw new Error("source-action-proof-rejected");
    const functionName = input.mode === "apply" ? "confirmCollateralTopUp" : "cancelExpiredCollateralTopUp";
    const data = encodeFunctionData({ abi: coreAbi, functionName, args: [input.creditId, proof.header, proof.proof] });
    await chain.call({ account: requester, to: env.core as Address, data });
    return { to: env.core, data, actionHash, mode: input.mode };
  },
};
