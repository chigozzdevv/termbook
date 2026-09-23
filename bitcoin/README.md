# Native Bitcoin collateral primitives

This directory provides bounded transaction checks for a prospective native BTC
collateral market. It is **not** a deployed vault, a Bitcoin consensus verifier, a
Monad verifier, or a custody service. Do not count BTC as collateral from the
return value of either function here.

`inspectFundingTransaction` parses a Bitcoin transaction, computes its `txid`
without SegWit witness data, and requires exactly one output paying an already
approved native P2WSH script with at least the expected satoshis. Its result is
explicitly `unverified`: the caller must still prove the transaction is in the
accepted Bitcoin chain, sufficiently confirmed, and that its output remains
unspent. A per-lock script must come from a separately reviewed custody policy
and be bound to the Termbook credit and Bitcoin owner before the user sends BTC.

`inspectExitPsbtV0` checks an unsigned PSBT v0 before a signer adds a signature.
The caller supplies an independently approved exact spend plan: ordered UTXOs,
their amounts and P2WSH scripts, ordered outputs, version, locktime, sequences,
and a maximum fee. The checker rejects unexpected inputs or outputs, mismatched
UTXO data or witness scripts, missing or non-`SIGHASH_ALL` requests, signatures,
unknown PSBT fields, and fees above the plan. A signer must enforce
`SIGHASH_ALL` when it actually signs, repeat the check after any PSBT update,
and independently confirm the UTXOs and destination scripts. This module does
not sign, broadcast, monitor, or prove a transaction.

## Production boundary

Native Bitcoin Script cannot execute a Monad light client or inspect Monad Core
state. A Bitcoin multisig or threshold signer that releases or seizes BTC after
observing a Monad authorization is **trusted custody**: signers can collude to
move BTC without authorization or refuse a valid return. The policy check above
reduces accidental or unilateral signer mistakes; it cannot eliminate that
trust. A Bitcoin transaction inclusion proof alone also does not prove that an
output is still unspent. Bitcoin UTXO status must be validated against the chain
state through an explicit, reviewed mechanism.

Before BTC is admitted, Termbook needs a decided and disclosed custody model,
per-lock script and key lifecycle, independently validated Bitcoin chain and
UTXO state on Monad, a final Monad authorization check by every spend signer,
replay and reorg handling, return and seizure confirmation back to Monad, and a
tested BTC sale and USDC delivery route. The current EVM `address` fields and
source-controller contracts also need a Bitcoin-specific representation and
integration. A committee signature or indexer report alone is not a light
client proof.

## Checks

From the repository root:

```sh
./node_modules/.bin/tsc -p bitcoin/tsconfig.json --noEmit
./node_modules/.bin/vitest run --config bitcoin/vitest.config.ts
./node_modules/.bin/eslint bitcoin --max-warnings=0
```

The transaction ID rule follows [BIP 141](https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki).
The PSBT fields and signer responsibilities follow [BIP 174](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki).
Bitcoin's [BIP 322](https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki)
also notes that a listed output is not proof it is still unspent.
