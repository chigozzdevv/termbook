# Termbook

Credit inside applications on Monad. Borrowers lock collateral on a supported
chain and draw funds from a House through a restricted Credit Account.

See `termbook.md` for the required behavior specification.

## Layout

- `contracts/` Foundry Solidity protocol
- `packages/bindings/` generated contract ABIs and deployments
- `packages/schema/` shared request and response schemas
- `packages/sdk/` borrower and LP client
- `server/` off-chain indexer and coordinator, no custody authority
- `solana/` native SOL custody program, admission disabled
- `scripts/` repo automation

## Commands

```sh
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
forge test
```

## Collateral markets

Termbook's settlement asset is set per HouseVault. A USDC House can accept a
different collateral asset only when the market has a verified lock, a fresh
USDC price, a recovery route, and the required governance configuration.

| Asset | Lock location | Current implementation |
| --- | --- | --- |
| MON | Native MON enters `NativeCollateralVault` on Monad and is held as WMON. | Local custody, native return, WMON sale for USDC, and oracle-backed collateral-only health reader. Requires reviewed WMON and USDC deployments, feed, risk bands, exit verifier, and market admission. |
| ETH | WETH stays in `CollateralVault` on Ethereum. | Full-field lock commitment and source-wallet flow are implemented. Finalized Ethereum-to-Monad lock and Monad-to-Ethereum action verifiers are required before accepting funds. |
| SOL | Native SOL stays in a Solana program-derived account. | Program and typed wallet binding are present, but the program rejects all deposits until bidirectional finality verification and the Monad non-EVM credit schema are implemented. |

`CollateralHealthReader` values bound collateral and free USDC held in the
Credit Account; it assigns zero value to application positions. Markets that
count application positions need a separate reviewed reader. Governance sets
the immutable feed and haircut for each market and registers the reader with
`HealthSource`. Different-token local collateral also needs an active
`TermbookCore` sale policy. During liquidation, a buyer pays USDC into the
HouseVault and receives WMON atomically at or above the oracle floor. If the
debt is repaid before all collateral is sold, the remaining MON can return to
the original recipient after the exit verifier approves.

## Aurora value routing

The settlement adapter uses Aurora Intents 1Click to quote an admitted ERC-20 source
asset into a House's settlement asset on Monad. The payer signs a route-bound
`InboxFactory` operation on Monad, then funds the returned source-chain deposit
address. The settlement worker observes the actual Monad inbox balance and submits
`notifyAll`, `settle`, or `refund`. Provider status never credits debt or mints LP
shares; the worker records it for reconciliation. `Credit.repay({ from: "aurora_intents" })` and cross-chain
`HouseAccount.deposit()` return a pending registration; use
`Settlement.fundErc20()` for the source transfer.

For remote recovery, an approved keeper authorizes seizure on Monad. The source
`RemoteCollateralController` verifies that finalized action and transfers seized
assets into `SourceRecoveryVault`. After a matching 1Click recovery quote is
registered, the configured route signer signs `Settlement.recoveryFunding()` and
anyone may call `Settlement.fundRecovery()`. The source vault sends its asset to
the provider deposit address. Delivered Monad settlement tokens then reduce the
Credit's debt through the same inbox worker. A source refund returns to the source
recovery vault and requires reconciliation with `recordSourceRefund`.

Configuration requires `SETTLEMENT_FACTORY`, `AURORA_API_KEY`,
`SETTLEMENT_KEEPER_KEY`, and `AURORA_ROUTES` on the server. Each JSON route entry
has `routeId`, `routeVersion`, `kind` (`repay`, `recovery`, or `lp_deposit`),
`sourceChain`, `sourceAsset`, `sourceAssetId`, `destinationAssetId`, `vault`,
`token`, `maxAmountIn`, and `slippageBps`. Recovery entries also require
`recoveryVault`. The identifiers must name the same assets as the EVM addresses.
Governance must admit the corresponding pair and version in `RouteRegistry`, then
set that registry on the House's `InboxFactory`. The factory address in the SDK
and server must be the factory configured on the HouseVault.

Remote collateral also requires source and Monad consensus light clients that
verify finalized contract events and lock state. After deploying the source
controller, governance must register its collateral vault and recovery vault in
TermbookCore, admit the verifier, and appoint a recovery keeper. The route signer
must be operated as a protected service that validates the signed 1Click quote,
source asset, recovery operation, and destination inbox before authorizing funding.
The Ethereum source verifier must prove the `lockCommitments(lockId)` storage
value against a finalized Ethereum state root and bind the admitted vault and
all lock fields. The source action proof must bind `RemoteActionApplied` to the exact
authorization hash; the Monad proof must bind `RemoteActionAuthorized` to the
same hash and the configured Core emitter.
No production consensus clients, live route approvals, or deployed asset configuration
are included in this repository. Source refund proof reconciliation, route liquidity limits,
and a live cross-chain recovery drill are required before opening remote collateral
or accepting production funds.
