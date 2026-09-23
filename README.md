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
forge test --root contracts
```

## Deployment stages

`scripts/deploy.sh` takes one stage and one RPC. `protocol`, `routing`,
`ethereum-verifier`, `native-collateral`, and `collateral-health-reader` require
Foundry 1.8 or newer, the Monad RPC, and `MONAD_CHAIN_ID`. The wrapper selects
Monad execution. `source` requires the Ethereum mainnet RPC,
`SOURCE_CHAIN_ID=1`, and `MONAD_CHAIN_ID=143`. The Ethereum verifier stage
also requires Monad mainnet. Every stage checks the connected chain before
broadcasting.

Deploy `protocol` first with explicit `GOVERNANCE`, `GUARDIAN`,
`HOUSE_MANAGER`, and `SETTLEMENT_ASSET`, then keep its `InboxFactory` address.
Run `routing` with that address as `MONAD_FACTORY_ADDRESS` and the protocol
governance contract as `GOVERNANCE_ADDRESS`; governance then calls
`InboxFactory.setRouteRegistry(routes)`. The routing stage deploys only the
registry. On Ethereum, `source` deploys the Monad verifier, recovery vault, and
controller; the controller creates its collateral vault. This stage requires a
deployed Ethereum governance contract and checks the Monad Core, HouseVault,
and inbox factory bindings at a Verified block using `MONAD_RPC_URL` and their
reviewed deployment code hashes. That RPC must serve historical state. Bind
`SourceRecoveryVault.setController(controller)` before the next stage. Run
`ethereum-verifier` on Monad with the source addresses and their Ethereum
runtime code hashes. Its wrapper checks the source chain, code hashes, and
vault bindings before broadcasting. Governance then admits the verifiers,
binds the vaults and recovery route, and unpauses the source controller. These
stages require audited consensus light clients before live funds are accepted.

## Collateral markets

Termbook's settlement asset is set per HouseVault. A USDC House can accept a
different collateral asset only when the market has a verified lock, a fresh
USDC price, a recovery route, and the required governance configuration.

| Asset | Lock location | Current implementation |
| --- | --- | --- |
| MON | Native MON enters `NativeCollateralVault` on Monad and is held as WMON. | Local custody, native return, WMON sale for USDC, and oracle-backed collateral-only health reader. Requires reviewed WMON and USDC deployments, feed, risk bands, exit verifier, and market admission. |
| ETH | WETH stays in `CollateralVault` on Ethereum. | Full-field lock commitment and source-wallet flow are implemented. Finalized Ethereum-to-Monad lock and Monad-to-Ethereum action verifiers are required before accepting funds. |
| SOL | Native SOL stays in a Solana program-derived account. | Typed quote and wallet identities are supported, but the program rejects deposits and actions until Solana and Monad finality verification is implemented and admitted. |

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

The settlement adapter uses Aurora Intents 1Click to quote an admitted ERC-20
source asset into a House's settlement asset on Monad. The payer signs a route
bound `InboxFactory` operation on Monad, then funds the returned source-chain
deposit address. The settlement worker observes the actual Monad inbox balance
and submits `notifyAll`, `settle`, or `refund`. Provider status never credits
debt or mints LP shares; the worker records it for reconciliation.
`Credit.repay({ from: "aurora_intents" })` and cross-chain
`HouseAccount.deposit()` return a pending registration. Use
`Settlement.fundErc20()` for the source transfer.

For remote recovery, an approved keeper authorizes seizure on Monad. The source
`RemoteCollateralController` verifies that finalized action and transfers seized
assets into `SourceRecoveryVault`. Monad Core confirms the finalized source
seizure. A matching 1Click recovery quote is registered with the
`createAuthorized` transaction hash. The recovery worker proves the finalized
`RecoveryOperationCreated` event to the source vault. The source vault checks
the full operation against the seized asset and amount, then
requires separate route and risk signatures over the provider deposit address.
The source vault sends its asset to that address. Delivered Monad settlement
tokens reduce the Credit's debt through the same inbox worker. A source refund
returns to the source recovery vault. The risk signer uses
`POST /recovery/refund/plan` to review the
finalized source ERC-20 transfer, outstanding operation, and Aurora status, then
submits a separate signature through `POST /recovery/refund/approve`. The worker
records the refund on the source vault after the route signer also signs. A refund
transaction must contain exactly one transfer of the recovery asset to the vault;
batched refunds require manual reconciliation because the source vault consumes
the transaction hash once. After debt clearance, the owner or borrower may
authorize return of any asset still held there.
`POST /recovery/return-held/prepare` supplies the proof and Ethereum
transaction for a wallet to sign and submit.

The recovery worker can fund a registered recovery quote when
`RECOVERY_SOURCE_RPCS` maps the EVM source chain ID to its RPC URL and
`RECOVERY_ROUTE_SIGNER_KEY`, `RECOVERY_RISK_SIGNER`, `RECOVERY_FUNDING_KEY`,
and `MONAD_PROOF_URL` are configured. The two signers must use different accounts.
The risk signer reads `/recovery/risk-approval-plan`, checks the quote and typed
data, then submits the signature through `/recovery/risk-approval`; its private
key stays outside the server. The worker checks the finalized factory operation
event, inbox, credit, admitted route, source vault, and signed quote before
funding. Source refund attribution requires the risk signer
to match the transfer with Aurora's operation; Aurora's origin transaction hashes
alone do not prove which refund belongs to an operation.

The Ethereum collateral proof worker needs `SOURCE_RPC_URL` with `eth_getProof`
support, `COLLATERAL_KEEPER_KEY`, and `SOURCE_PROOF_URL`. The proof service must
return the admitted client's finalized header proof plus the matching block
number, block hash, and state root at `/proof/{lockId}`. The worker checks the
canonical Ethereum block, storage proof, and Monad verifier before relay. The
source action worker uses `MONAD_PROOF_URL` for finalized Monad authorizations
and `SOURCE_PROOF_URL` for finalized Ethereum action receipts. For an expired
seizure or return that was never executed, `POST /collateral/actions/cancel`
prepares a cancellation using a finalized Ethereum storage proof from
`/absence/{actionHash}`. Production consensus clients and header proof producers
are still required. Monad receipt proof generation waits until the source block
reaches Verified execution, three blocks after Finalized.

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
controller, `SOURCE_GOVERNANCE` must call
`SourceRecoveryVault.setController(controller)` and then
`RemoteCollateralController.setPaused(false)` before accepting locks. The
controller and its vault deploy paused. Governance can set the recovery vault's
pause guardian separately. A route pause stops new recovery funding; an
emergency or controller pause also stops proof-authorized returns. Refund
recording remains available. Governance must register the collateral vault and
recovery vault in TermbookCore, admit the verifier, and appoint a recovery
keeper. The route and risk signers must separately validate the signed 1Click
quote, source asset, recovery operation, and destination inbox before funding.
The Ethereum source verifier must prove the `lockCommitments(lockId)` storage
value against a finalized Ethereum state root and bind the admitted vault and
all lock fields. The source action proof must bind `RemoteActionApplied` to the exact
authorization hash; the Monad proof must bind `RemoteActionAuthorized` to the
same hash and the configured Core emitter.
No production consensus clients, live route approvals, or deployed asset
configuration are included in this repository. Route liquidity limits and a
live cross-chain recovery drill are required before accepting production funds.
