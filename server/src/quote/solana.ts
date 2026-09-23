import { encodeAbiParameters, keccak256, stringToHex } from "viem";

const aliasDomain = keccak256(stringToHex("Termbook Solana alias v1"));
const quoteDomain = keccak256(stringToHex("Termbook Solana quote v1"));

export type SolanaQuoteIdentity = {
  sourceGenesis: `0x${string}`;
  sourceVault: `0x${string}`;
  sourceAsset: `0x${string}`;
  sourceOwner: `0x${string}`;
  returnRecipient: `0x${string}`;
  recoveryVault: `0x${string}`;
  verifierVersion: bigint;
};

export function solanaAlias(genesis: `0x${string}`, id: `0x${string}`): `0x${string}` {
  const hash = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [aliasDomain, genesis, id],
  ));
  return `0x${hash.slice(-40)}`;
}

export function solanaQuoteDigest(baseDigest: `0x${string}`, identity: SolanaQuoteIdentity): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" },
    ],
    [
      quoteDomain, baseDigest, identity.sourceGenesis, identity.sourceVault,
      identity.sourceAsset, identity.sourceOwner, identity.returnRecipient,
      identity.recoveryVault, identity.verifierVersion,
    ],
  ));
}

export function matchesSolanaAliases(
  aliases: { owner: string; collateralVault: string; collateralAsset: string; returnRecipient: string },
  identity: SolanaQuoteIdentity,
): boolean {
  const { sourceGenesis } = identity;
  return aliases.owner.toLowerCase() === solanaAlias(sourceGenesis, identity.sourceOwner).toLowerCase()
    && aliases.collateralVault.toLowerCase() === solanaAlias(sourceGenesis, identity.sourceVault).toLowerCase()
    && aliases.collateralAsset.toLowerCase() === solanaAlias(sourceGenesis, identity.sourceAsset).toLowerCase()
    && aliases.returnRecipient.toLowerCase() === solanaAlias(sourceGenesis, identity.returnRecipient).toLowerCase();
}
