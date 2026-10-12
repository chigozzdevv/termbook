import { isEvmSource } from "../chain/networks.js";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { fetchEthereumSnapshot } from "../chain/ethereum-wormhole-snapshot.js";
import { fetchSolanaProof } from "../collateral/solana-proof.js";

const coreAbi = parseAbi([
  "function lastRemoteSeizureHash(bytes32) view returns (bytes32)",
  "function confirmRemoteRecoveryClearance(bytes32,bytes,bytes)",
]);
const verifierAbi = parseAbi(["function sourceController() view returns (address)"]);

export async function recoveryClearancePlan(input: { creditId: Hex; sourceTx?: string }, wallet: Address) {
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("recovery-chain-mismatch");
  const blockNumber = (await chain.getBlock({ blockTag: "finalized" })).number;
  const core = env.core as Address;
  const [c, registry, sourceChain, isSolana, seizure, recoveryVault, keeper] = await Promise.all([
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails", args: [input.creditId], blockNumber }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "verifierRegistry", blockNumber }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "collateralSourceChainOf", args: [input.creditId], blockNumber }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "solanaCollateral", args: [input.creditId], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "lastRemoteSeizureHash", args: [input.creditId], blockNumber }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "remoteRecoveryVaultOf", args: [input.creditId], blockNumber }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "recoveryKeepers", args: [wallet], blockNumber }),
  ]);
  if (c.revision === 0n || (!keeper && c.borrower.toLowerCase() !== wallet.toLowerCase())) {
    throw new Error("permission-denied");
  }
  const [verifier, version, active,, hash] = await chain.readContract({ address: registry, abi: verifierRegistryAbi,
    functionName: "verifiers", args: [sourceChain], blockNumber });
  const runtime = await chain.getCode({ address: verifier, blockNumber });
  if (!active || version !== c.verifierVersion || hash !== c.verifierCodeHash || !runtime
    || keccak256(runtime) !== hash) throw new Error("recovery-verifier-unavailable");
  let proof: { header: Hex; proof: Hex };
  if (isSolana) {
    const rpcUrl = process.env["SOLANA_RPC_URL"];
    const proofUrl = process.env["SOLANA_PROOF_URL"];
    if (!rpcUrl || !proofUrl || !input.sourceTx) throw new Error("recovery-solana-source-proof-required");
    const [identity, lockPda, market] = await Promise.all([
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "solanaIdentityOf", args: [input.creditId], blockNumber }),
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "solanaLockPdaOf", args: [input.creditId], blockNumber }),
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "solanaMarkets", args: [sourceChain], blockNumber }),
    ]);
    proof = await fetchSolanaProof({ rpcUrl, proofUrl, kind: "recovery", digest: seizure,
      genesis: identity[0], programId: identity[1], programDataHash: market[2],
      lockPda, accountPda: identity[5], sourceTx: input.sourceTx });
  } else {
    if (!isEvmSource(sourceChain)) throw new Error("recovery-proof-market-unsupported");
    const controller = await chain.readContract({ address: verifier, abi: verifierAbi,
      functionName: "sourceController", blockNumber });
    const digest = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
      [input.creditId, recoveryVault, seizure]));
    proof = await fetchEthereumSnapshot({ sourceChain, verifier, vault: c.collateralVault, controller,
      kind: 4, digest, creditId: input.creditId });
  }
  const data = encodeFunctionData({ abi: coreAbi, functionName: "confirmRemoteRecoveryClearance",
    args: [input.creditId, proof.header, proof.proof] });
  await chain.call({ to: core, data, account: wallet });
  return { to: core, data, chainId: env.monadChainId, creditId: input.creditId };
}
