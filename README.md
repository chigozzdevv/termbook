# Termbook

Credit inside applications on Monad. Borrowers lock collateral on a supported
chain and draw funds from a House through a restricted Credit Account.

See `termbook.md` for the required behavior specification.

## Layout

- `contracts/evm/` Foundry project for Monad and Ethereum contracts
- `contracts/evm/src/monad/` contracts deployed on Monad
- `contracts/evm/src/ethereum/` contracts deployed on Ethereum
- `contracts/evm/src/shared/` code compiled into either EVM deployment
- `contracts/solana/` native SOL custody program, admission disabled
- `packages/bindings/` generated contract ABIs and deployments
- `packages/schema/` shared request and response schemas
- `packages/sdk/` borrower and LP client
- `server/` off-chain indexer and coordinator, no custody authority
- `scripts/` repo automation

## Commands

```sh
pnpm install
forge build --root contracts/evm
pnpm codegen
pnpm build
pnpm lint
pnpm typecheck
pnpm test
forge test --root contracts/evm
(cd contracts/solana && cargo test --offline)
```

## Deployment stages

The server publishes an admitted integration's SDK configuration at
`GET /integrations/config?app_token=...`. Set `PUBLIC_API_BASE` and
`PUBLIC_RPC_URL` to public HTTPS endpoints and `ACCOUNT_FACTORY_ADDRESS` to
the deployed Monad factory. Build the SDK with `TERMBOOK_PUBLIC_API_BASE` set
to the same API origin. An admin can issue a public app token with
`POST /integrations` after the IntegrationVersion, HealthSource reader, exit
verifier, pinned app recovery adapter, and reviewed recovery calls are active
onchain. The token is shown only at creation; the
server stores its hash. Borrower intents created through the SDK are bound to
that IntegrationVersion.

The approval request includes the House settlement asset and an `actions`
array. Each action names a public
capability, its approved contract target and ABI function, and the source of
each ABI argument (`input`, `borrower`, `credit_account`, or `credit_id`).
`fundingPath` identifies the borrower input used to calculate the required
settlement-token draw. The server checks the target and selector against the
finalized IntegrationRegistry policy before publishing the app token. The SDK
builds calldata from this manifest; an app passes only a capability and typed
parameters to `open({ action })`. For example:

```json
{
  "capability": "place_order",
  "label": "Place order",
  "target": "0x0000000000000000000000000000000000000001",
  "signature": "function placeOrder(string market,uint8 direction,uint8 orderType,uint256 margin,uint256 notional,uint16 slippageBps,address account)",
  "arguments": [
    { "source": "input", "path": "market_id", "label": "Market ID" },
    { "source": "input", "path": "direction", "choices": { "long": "1", "short": "2" } },
    { "source": "input", "path": "order_type", "choices": { "market": "1", "limit": "2" } },
    { "source": "input", "path": "amount.margin", "label": "Margin in base units", "min": "1" },
    { "source": "input", "path": "amount.notional", "label": "Notional in base units", "min": "1" },
    { "source": "input", "path": "slippage_bps", "label": "Slippage in bps", "max": "10000" },
    { "source": "credit_account" }
  ],
  "fundingPath": "amount.margin",
  "settlement": "asynchronous"
}
```

The address and function above illustrate the manifest format; admission
requires the actual deployed target and matching onchain call policy.
Application position valuation, forced unwind, and exit verification must be
reviewed for each integration before it is admitted. The repository's
`CollateralHealthReader` values collateral and Credit Account cash only.

An active House polls `POST /houses/intents` with its House wallet and optional
`cursor: { createdAt, id }`. The feed contains unexpired intents for that
House's settlement asset. The House signs a complete collateral-bound quote
and submits it to `POST /quotes`. Offers are checked against the finalized
HouseRegistry and vault asset, then ranked by estimated cost for a common draw
and duration. The displayed estimate includes origination, interest, and
commitment fees under those assumptions.

`CreditApp.review()` simulates the exact action through `Core.previewAction`
and displays the resulting debt, recoverable value, and health threshold. The
simulation always reverts its state changes. Actual execution repeats the
checks with the borrower's signature and enforces post-action health. During
liquidation, an approved keeper calls `recoverApp` through the bundle's pinned
adapter and registered recovery call, then repays recovered account cash to
HouseVault. Freezing new app actions does not disable a reviewed recovery call.
Each integration still needs a concrete reader and adapter for its deployed app.
An application reader must implement `IAppStateReader` to enumerate at most
32 current positions and 32 pending actions for a Credit Account. The server
reads that state at one finalized Monad block through the bundle's pinned
`AppHealthReader`; an unavailable, stale, changed, or incomplete reader returns
`application-state-unavailable` instead of an empty list.

`COLLATERAL_MARKETS` publishes the admitted source-wallet choices in the modal.
It is a JSON array of EVM entries (`id`, `label`, `decimals`, `chainId`,
`rpcUrl`, `asset`, `vault`, `controller`, `nativeVault`) or Solana entries
(`id`, `label`, `decimals`, `chainId`, `rpcUrl`, `genesis`, `asset`, `program`).
The catalog checks each entry against finalized Core market bindings. Apps
that support SOL provide a `sourceWalletResolver` in SDK configuration to
connect their Solana wallet adapter; the borrower chooses that wallet in the
modal.

`scripts/deploy.sh` takes one stage and one RPC. `protocol`, `routing`,
`ethereum-beacon-client`, `ethereum-verifier`, `native-collateral`,
`collateral-health-reader`, and `app-health-reader` require
Foundry 1.8 or newer, the Monad RPC, and `MONAD_CHAIN_ID`. The wrapper selects
Monad execution. `source` requires the Ethereum mainnet RPC,
`SOURCE_CHAIN_ID=1`, and `MONAD_CHAIN_ID=143`. The Ethereum verifier stage
also requires Monad mainnet. Every stage checks the connected chain before
broadcasting.

Recompute reviewed runtime code hashes when rebuilding from this layout;
Solidity source paths and remappings affect bytecode metadata.

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
`SourceRecoveryVault.setController(controller)` before the next stage. Deploy
`ethereum-beacon-client` on Monad from an independently verified recent Fulu
checkpoint with `ETHEREUM_CHECKPOINT_FILE` and a deployed
`ETHEREUM_CHECKPOINT_GOVERNANCE` contract, then run `ethereum-verifier` with
`ETHEREUM_LIGHT_CLIENT_ADDRESS`, the source addresses, and their Ethereum
runtime code hashes. Its wrapper checks the source chain, code hashes, and
vault bindings before broadcasting. Governance then admits the verifiers,
binds the vaults and recovery route, and unpauses the source controller. These
stages require audited consensus light clients before live funds are accepted.

The worker relays Ethereum Beacon updates when
`ETHEREUM_LIGHT_CLIENT_ADDRESS`, `ETHEREUM_BEACON_API_URL`,
and `ETHEREUM_BEACON_KEEPER_KEY` are configured. It builds the BLS witness
from Beacon light-client committee data and checks
the stored committee root, simulates the update, and warns when the checkpoint
is over 12 days old. Governance must independently verify any checkpoint used
to recover from expiry; the relay cannot establish weak subjectivity by itself.

## Collateral markets

Termbook's settlement asset is set per HouseVault. A USDC House can accept a
different collateral asset only when the market has a verified lock, a fresh
USDC price, a recovery route, and the required governance configuration.

| Asset | Lock location | Current implementation |
| --- | --- | --- |
| MON | Native MON enters `NativeCollateralVault` on Monad and is held as WMON. | Local custody, native return, WMON sale for USDC, and oracle-backed collateral-only health reader. Requires reviewed WMON and USDC deployments, feed, risk bands, exit verifier, and market admission. |
| ETH | WETH stays in `CollateralVault` on Ethereum. | Lock custody and a Fulu Ethereum-to-Monad Beacon verifier are implemented. The Monad-to-Ethereum consensus verifier and live proof pipeline are required before accepting funds. |
| SOL | Native SOL stays in a Solana program-derived account. | The SDK encodes the lock and source actions, and the server prepares proof-gated lock and action relays. The program rejects deposits and actions until both finality verifiers are implemented and admitted. |

For SOL, a Solana wallet signs the SDK `SolanaSourceLockWallet` lock instruction.
The borrower tracks its bound lock with `POST /collateral/solana`; the server
proves the finalized Solana lock to Monad. After a Core return or seizure
authorization, an authorized actor obtains
`POST /collateral/solana/actions/plan`, submits that exact instruction on
Solana, then obtains `POST /collateral/solana/actions/confirmation-plan` to
confirm the finalized source action or cancellation on Monad. These endpoints
require an admitted onchain verifier and a proof producer pinned to the market's
Solana program data hash. After a confirmed seizure, a recovery keeper can
request `POST /collateral/solana/recovery/funding-plan` for an already registered
operation and finalized `SolanaRecoveryFundAuthorized` event. The SDK encodes
the matching `FundRecovery` instruction. The
`POST /collateral/solana/recovery/confirmation-plan` endpoint prepares a Monad
confirmation from the finalized recovery ledger, or an expiry cancellation
from proof that the funding did not execute. Core keeps the authorization
pending until one of those proofs clears it. That authorization reserves the SOL
for a bounded sale even if the debt is repaid later. If proceeds reach the
Monad inbox after debt reaches zero, settlement cannot apply them and the
inbox refunds available funds to the borrower after its deadline. A live SOL
route needs an admitted Aurora quote with a Solana deposit pubkey and
independent route and risk signatures. The funding plan checks the signed
quote's exact deposit pubkey and source refund PDA. If a failed route returns
SOL to that PDA, `ReconcileRecoveryRefund` credits the actual excess balance;
`POST /collateral/solana/recovery/refund-reconciliation-plan` prepares the
finalized proof that increases Core's available recovery balance. The source
record proves returned SOL, not the sender of the transfer.
When debt is zero, the borrower can request
`POST /collateral/solana/recovery/payout-plan` for a finalized
`SolanaRecoveryReturnAuthorized` event and return unallocated held SOL to the
original Solana recipient. The SDK builds `RecoveryPayout`; the separate
`payout-confirmation-plan` proves execution or expiry to clear Core's pending
payout state.

`CollateralHealthReader` values bound collateral and free USDC held in the
Credit Account; it assigns zero value to application positions. Markets that
count application positions can register `AppHealthReader` for that bundle.
It combines the collateral reading with a pinned, application-specific
`IAppValueReader` and checks the pinned recovery adapter before counting app
value. The application reader reports stressed proceeds after liabilities in
settlement-token base units, with remaining exit costs reported separately.
Governance sets
the immutable feed and haircut for each market and registers the reader with
`HealthSource`. Different-token local collateral also needs an active
`TermbookCore` sale policy. During liquidation, a buyer pays USDC into the
HouseVault and receives WMON atomically at or above the oracle floor. If the
debt is repaid before all collateral is sold, the remaining MON can return to
the original recipient after the exit verifier approves.

Deploy `app-health-reader` with `APP_BUNDLE_ID`, `COLLATERAL_READER_ADDRESS`,
`APP_READER_ADDRESS`, and `APP_RECOVERY_ADAPTER_ADDRESS` after Core registers
the adapter. Governance then registers that reader for the bundle in
`HealthSource` before new Credits use it.

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
`token`, `maxAmountIn`, and `slippageBps`. Ethereum recovery entries require
`recoveryVault`. Solana routes set `sourceAddressFormat` to `solana`; their
recovery refund address is the per-credit Solana account proven against Core.
The identifiers must name the same assets as the EVM addresses.
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
