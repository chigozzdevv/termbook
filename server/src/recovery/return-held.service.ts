import { isEvmSource, evmSourceRpcUrl, configuredEvmSources } from "../chain/networks.js";
import {
  createPublicClient, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, http, keccak256, padHex, parseAbi,
  stringToHex, type Address, type Hex, type TransactionReceipt,
} from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { authorizationLogIndex, fetchMonadReceiptProof } from "../chain/monad-receipt-proof.js";
import { monadClient } from "../chain/monad.client.js";
import { currentEthereumAuthorization } from "../chain/monad-wormhole.js";
import { env } from "../config/env.js";
import { HttpError } from "../http/http.errors.js";

const coreAbi = parseAbi([
  "function collateralSourceChainOf(bytes32) view returns (uint256)",
  "function collateralOwnerOf(bytes32) view returns (address)",
  "function remoteRecoveryVaultOf(bytes32) view returns (address)",
  "function remoteSeizureConfirmed(bytes32) view returns (bool)",
  "function sourceRecoveryReturnHash(bytes32,uint256,uint256,uint256) view returns (bytes32)",
]);
const sourceAbi = parseAbi([
  "function asset() view returns (address)",
  "function controller() view returns (address)",
  "function verifier() view returns (address)",
  "function monadChain() view returns (uint256)",
  "function held(bytes32) view returns (uint256)",
  "function returnHeldHash(bytes32,address,uint256,uint256,uint256) view returns (bytes32)",
  "function returnHeld(bytes32,address,uint256,uint256,uint256,bytes,bytes)",
]);
const controllerAbi = parseAbi([
  "function monadCore() view returns (address)",
  "function recoveryVault() view returns (address)",
]);
const wormholeVerifierAbi = parseAbi([
  "function wormholeMode() pure returns (bool)",
  "function verifyEvent(bytes,bytes,address,bytes32) view returns (bool)",
]);
const returnTopic = keccak256(stringToHex(
  "SourceRecoveryReturnAuthorized(bytes32,bytes32,address,uint256,uint256,uint256)",
));
const zeroAddress = "0x0000000000000000000000000000000000000000";

function equal(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function sourceRecoveryReturnEvent(receipt: TransactionReceipt, core: Address, creditId: Hex) {
  if (receipt.status !== "success") throw new Error("return-held-authorization-reverted");
  const matches = receipt.logs.flatMap((log) => {
    if (!equal(log.address, core) || log.topics.length !== 4 || !equal(log.topics[0] ?? "", returnTopic)
      || !equal(log.topics[1] ?? "", creditId) || !log.topics[2] || !log.topics[3]
      || log.data.length !== 194) return [];
    const owner = `0x${log.topics[3].slice(26)}` as Address;
    if (!equal(padHex(owner, { size: 32 }), log.topics[3])) return [];
    const [amount, nonce, deadline] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], log.data,
    );
    if (owner === zeroAddress || amount === 0n || nonce === 0n || deadline === 0n) return [];
    return [{ actionHash: log.topics[2] as Hex, owner, amount, nonce, deadline }];
  });
  if (matches.length !== 1) throw new Error("return-held-authorization-log-mismatch");
  return matches[0]!;
}

export async function prepareHeldReturn(input: { creditId: Hex; authorizationTxHash: Hex }, wallet: Address) {
  if (!configuredEvmSources().length || env.core === zeroAddress) {
    throw new HttpError(503, "return-held-unavailable");
  }
  const monad = monadClient();
  if (await monad.getChainId() !== env.monadChainId) throw new HttpError(503, "return-held-monad-chain-mismatch");
  const core = env.core as Address;
  const receipt = await monad.getTransactionReceipt({ hash: input.authorizationTxHash });
  const authorized = sourceRecoveryReturnEvent(receipt, core, input.creditId);
  const finalized = await monad.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) throw new Error("return-held-authorization-not-finalized");
  const canonical = await monad.getBlock({ blockNumber: receipt.blockNumber });
  if (!equal(canonical.hash, receipt.blockHash)) throw new Error("return-held-authorization-changed");
  const at = finalized.number;
  const [credit, sourceChain, owner, vault, confirmed, actionHash] = await Promise.all([
    monad.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails", args: [input.creditId], blockNumber: at }),
    monad.readContract({ address: core, abi: coreAbi, functionName: "collateralSourceChainOf", args: [input.creditId], blockNumber: at }),
    monad.readContract({ address: core, abi: coreAbi, functionName: "collateralOwnerOf", args: [input.creditId], blockNumber: at }),
    monad.readContract({ address: core, abi: coreAbi, functionName: "remoteRecoveryVaultOf", args: [input.creditId], blockNumber: at }),
    monad.readContract({ address: core, abi: coreAbi, functionName: "remoteSeizureConfirmed", args: [input.creditId], blockNumber: at }),
    monad.readContract({ address: core, abi: coreAbi, functionName: "sourceRecoveryReturnHash",
      args: [input.creditId, authorized.amount, authorized.nonce, authorized.deadline], blockNumber: at }),
  ]);
  if (!isEvmSource(sourceChain) || !confirmed || credit.debt !== 0n || vault === zeroAddress
    || !equal(owner, authorized.owner) || !equal(actionHash, authorized.actionHash)
    || (wallet.toLowerCase() !== owner.toLowerCase() && wallet.toLowerCase() !== credit.borrower.toLowerCase())) {
    throw new HttpError(409, "return-held-core-binding-mismatch");
  }
  const source = createPublicClient({ transport: http(evmSourceRpcUrl(sourceChain)) });
  if (BigInt(await source.getChainId()) !== sourceChain) throw new HttpError(503, "return-held-source-chain-mismatch");
  const sourceFinalized = await source.getBlock({ blockTag: "finalized" });
  const [sourceAsset, controller, monadChain, held, sourceHash] = await Promise.all([
    source.readContract({ address: vault, abi: sourceAbi, functionName: "asset", blockNumber: sourceFinalized.number }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "controller", blockNumber: sourceFinalized.number }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "monadChain", blockNumber: sourceFinalized.number }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "held", args: [input.creditId], blockNumber: sourceFinalized.number }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "returnHeldHash",
      args: [input.creditId, owner, authorized.amount, authorized.nonce, authorized.deadline], blockNumber: sourceFinalized.number }),
  ]);
  if (!equal(sourceAsset, credit.collateralAsset) || controller === zeroAddress
    || monadChain !== BigInt(env.monadChainId) || held < authorized.amount
    || !equal(sourceHash, authorized.actionHash)) throw new HttpError(409, "return-held-source-binding-mismatch");
  const [controllerCore, controllerVault] = await Promise.all([
    source.readContract({ address: controller, abi: controllerAbi, functionName: "monadCore", blockNumber: sourceFinalized.number }),
    source.readContract({ address: controller, abi: controllerAbi, functionName: "recoveryVault", blockNumber: sourceFinalized.number }),
  ]);
  if (!equal(controllerCore, core) || !equal(controllerVault, vault)) {
    throw new HttpError(409, "return-held-controller-binding-mismatch");
  }
  const verifier = await source.readContract({
    address: vault, abi: sourceAbi, functionName: "verifier", blockNumber: sourceFinalized.number,
  });
  const wormhole = await source.readContract({
    address: verifier, abi: wormholeVerifierAbi, functionName: "wormholeMode",
    blockNumber: sourceFinalized.number,
  }).catch(() => false);
  let proof = wormhole
    ? await currentEthereumAuthorization({
      core, creditId: input.creditId, actionHash: authorized.actionHash,
      kind: 0, recoveryReturn: true,
    })
    : await fetchMonadReceiptProof({
      txHash: input.authorizationTxHash,
      selectLog: (provedReceipt) => {
        const proved = sourceRecoveryReturnEvent(provedReceipt, core, input.creditId);
        if (proved.actionHash !== authorized.actionHash || !equal(proved.owner, authorized.owner)
          || proved.amount !== authorized.amount || proved.nonce !== authorized.nonce
          || proved.deadline !== authorized.deadline) throw new Error("return-held-authorization-changed");
        return authorizationLogIndex(provedReceipt, core, input.creditId, authorized.actionHash, 0);
      },
    });
  if (wormhole) {
    const digest = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }],
      [input.creditId, authorized.actionHash, 0],
    ));
    const valid = await source.readContract({
      address: verifier, abi: wormholeVerifierAbi, functionName: "verifyEvent",
      args: [proof.header, proof.proof, core, digest],
    });
    if (!valid) {
      proof = await currentEthereumAuthorization({
        core, creditId: input.creditId, actionHash: authorized.actionHash,
        kind: 0, recoveryReturn: true, refresh: true,
      });
    }
  }
  const args = [input.creditId, owner, authorized.amount, authorized.nonce, authorized.deadline,
    proof.header, proof.proof] as const;
  try {
    await source.simulateContract({ address: vault, abi: sourceAbi, functionName: "returnHeld", args, account: wallet });
  } catch {
    throw new HttpError(409, "return-held-preflight-failed");
  }
  return {
    chainId: Number(sourceChain),
    to: vault,
    data: encodeFunctionData({ abi: sourceAbi, functionName: "returnHeld", args }),
    creditId: input.creditId,
    owner,
    amount: authorized.amount.toString(),
    deadline: authorized.deadline.toString(),
    actionHash: authorized.actionHash,
  };
}
