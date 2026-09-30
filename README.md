# Termbook

Credit inside applications on Monad. Borrowers lock collateral on a supported
chain and draw funds from a House through a restricted Credit Account.

See `termbook.md` for the required behavior specification.

## Layout

- `contracts/evm/` Foundry project for Monad and Ethereum contracts
- `contracts/evm/src/monad/` contracts deployed on Monad
- `contracts/evm/src/ethereum/` contracts deployed on Ethereum
- `contracts/evm/src/shared/` code compiled into either EVM deployment
- `contracts/solana/` native SOL custody program
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

Foundry pins Solidity 0.8.24 and Cancun bytecode while running tests on Prague,
so the Ethereum BLS precompile tests execute locally instead of being skipped.

## API authorization

Each POST has its own wallet authorization. Manual clients request `/auth/nonce`
with `wallet`, `method: "POST"`, the exact `path`, and `bodyHash`, calculated as
`hashMessage(canonicalJson(body))`. Sign the returned message and submit the
original body with `x-termbook-wallet`, `x-termbook-signature`, and
`x-termbook-nonce`. The challenge binds the API domain, request, expiry and wallet.
Only a valid signature consumes the nonce; consumption is atomic across replicas.
Contract wallets use ERC-1271 at a finalized block. The SDK validates challenges
before signing. App tokens identify integrations and confer no wallet authority.

Queue delivery is at least once. BullMQ IDs are deterministic hashes; Mongo
fallback jobs use renewable leases and bounded retries. Handlers reconcile
confirmed onchain state before submitting another transaction.

## Deployment stages

The server publishes an admitted integration's SDK configuration at
`GET /integrations/config?app_token=...`. Set `PUBLIC_API_BASE` and
`PUBLIC_RPC_URL` to public HTTPS endpoints and `ACCOUNT_FACTORY_ADDRESS` to
the deployed Monad factory. Build the SDK with `TERMBOOK_PUBLIC_API_BASE` set
to the same API origin.

An app owner calls `POST /applications` with `name`, `origin`, and `chainId`.
The owner places the returned TXT value at `_termbook.<origin-host>` and calls
`POST /applications/:id/verify-origin`. The signed wallet is the application
owner; origin verification is repeated before publication. Signed
`POST /applications/:id/details` resumes an interrupted registration. The owner then calls
`POST /integrations/draft` with `applicationId` and up to 32 entries containing
target, code hash, function signature, and example transaction hash. References
may be direct app transactions, router transactions with one unambiguous traced
app call, or existing Core actions. The response contains a candidate ID and
imported source and call evidence; it does not assign economic meaning. Signed
`POST /integrations/candidates/:id/details` resumes an interrupted candidate.

The owner submits a reviewed `category`, `versionId`, `codeHash`, settlement
asset, `actions`, and `verifiedSources` to
`POST /integrations/candidates/:id/mapping`. Each action names its approved
target, ABI function, and argument source (`input`, `borrower`,
`credit_account`, or `credit_id`). Perps mappings must include placement and
closure. The candidate stays inactive in `ready_to_test` until the owner submits
an `acceptance` record to `POST /integrations/candidates/:id/evidence`. It
includes the complete `suite`, its canonical `evidenceHash`, active and recovered
Credit IDs, one actual Core action transaction per declared capability, recovery
transaction hashes, and an account-funded House repayment hash. `GET
/integrations/validation` lists the cases covering the specification's 16 acceptance
requirements. Each applicable case records pinned contract identities, canonical
blocks, before/after reads, asserted outcomes, transactions or simulations, roles,
and gas limits. Rejection cases require a successful control at the same block.
The server replays deployment observations and simulations, verifies transaction
inputs and receipts, checks live app value and empty recovered positions, and
requires recovery by an approved keeper distinct from the borrower. A reviewer
checks the economic meaning and coverage of every assertion before publication.

Use `IntegrationValidationRunner` from the SDK, or run:

```sh
node --import tsx scripts/validate-integration.ts validation.json
```

The JSON config contains `rpcUrl`, `suite` metadata, `module`, `parameters`,
`gasLimit`, `checkpoint`, and `output` paths. The reviewed module exports
`createScenarios(parameters, actors)` returning named `cases` and justified
`exclusions`. Cases call the recorder's `observe`, `simulate`, `transact`, and
`assert` methods. Use the actual supported account and role model at minimum and
maximum supported sizes. Set `TERMBOOK_VALIDATION_BORROWER_KEY`,
`TERMBOOK_VALIDATION_KEEPER_KEY`, and `TERMBOOK_VALIDATION_UNAUTHORIZED_KEY`
for the three distinct wallets bound in the suite metadata. The runner saves
state and submitted transaction hashes before waiting for finality; rerunning
resumes the same case and transaction. The server records `validating` with a
renewed lease, rejects concurrent submissions, and restores `ready_to_test` with
a failure code when validation fails.

A fork report pins its finalized parent block and deployments. It is reviewed
as a fork artifact, since its synthetic transactions cannot be checked through
the deployment RPC. Publication also requires a reviewer signature over
`integrationForkReview(suite)` from the SDK, submitted as `forkReviewSignature`.
Actual deployment action, valuation, keeper-recovery and repayment samples remain
mandatory. Fork results cannot substitute for those deployed permission checks.

Only an admin publishes a candidate in `security_review` using
`POST /integrations` with `{ "candidateId": "..." }`. Publication repeats
source and onchain admission checks and issues a public app token. The token is
shown once and stored only as a hash. Publication uses a MongoDB transaction,
so the database deployment must support transactions. The IntegrationVersion, health reader,
exit verifier, recovery adapter, reviewed action and recovery calls, and their
call validators must be active onchain. Core calls the validators on every app
action and recovery step. Registration pins targets and validators as bounded
runtime dependencies. Delegating bytecode requires a pinned deployment guard
before activation. `ImplementationGuard` checks the reviewed proxy getter and
implementation code hash on every action and recovery step; an upgrade makes
the version inactive. The reviewer must verify that the getter reads the actual
delegation target. Proxies without an enforceable getter or reviewed custom
guard cannot be admitted. Mutable configuration and indirect dependencies must
also be pinned with `pinDependency` and a guard that checks the reviewed state.
Health readers, exit verifiers, planners, and recovery adapters use direct,
nondelegating contracts with pinned code hashes.
`StaticCallValidator` covers fixed-width ABI calls with exact, account, range,
and spend bounds. Calls with dynamic arguments or app-specific state checks need
a reviewed validator implementing `IAppCallValidator`.
`steps` defines up to seven preceding calls before the primary call. Every
`fundingPath` contributes to the required settlement-token input, including
separately funded execution fees. `marketPath` and `exposurePath` bind the market
and exposure independently of margin. Price-sensitive capabilities declare `price`
with slippage and direction input paths, reviewed maximum/minimum directions, and
market identifiers. Core's immutable `PriceProtection` rule pins the oracle feed,
call target, selector, direction and price words, units, deviation and age bounds.
The SDK derives the price argument from the reviewed oracle round; the signed
authorization binds that round and the exact rounded bound. Execution checks the
original round and current feed validity without recentering the bound. House
slippage caps are part of the signed reservation policy. Perps placement and
closure mappings require these rules before publication. Feeds used for execution
need a pinned deployment guard that verifies their implementation and material
configuration, including any feed-specific confidence checks. The server checks each target and selector against the
finalized IntegrationRegistry policy before publishing the app token. The SDK
builds calldata from this manifest; an app passes only a capability and typed
parameters to `open({ action })`. For example:

```json
{
  "capability": "place_order",
  "label": "Place order",
  "target": "0x0000000000000000000000000000000000000001",
  "signature": "function placeOrder(uint256 market,uint8 direction,uint8 orderType,uint256 margin,uint256 notional,uint256 priceBound,address account)",
  "arguments": [
    { "source": "input", "path": "market_id", "label": "Market ID in base units" },
    { "source": "input", "path": "direction", "choices": { "long": "1", "short": "2" } },
    { "source": "input", "path": "order_type", "choices": { "market": "1", "limit": "2" } },
    { "source": "input", "path": "amount.margin", "label": "Margin in base units", "min": "1" },
    { "source": "input", "path": "amount.notional", "label": "Notional in base units", "min": "1" },
    { "source": "price_bound" },
    { "source": "credit_account" }
  ],
  "fundingPath": "amount.margin",
  "marketPath": "market_id",
  "exposurePath": "amount.notional",
  "price": {
    "slippagePath": "slippage_bps",
    "directionPath": "direction",
    "maximumDirections": ["long"],
    "minimumDirections": ["short"],
    "markets": ["0x0000000000000000000000000000000000000000000000000000000000000001"]
  },
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

Registered Houses require a complete quote binding the immutable reservation
policy, bond payer, and refund recipient. `ReservationManager` enforces a minimum
annual reservation rate of 100 basis points, a setup duration of at most seven
days, a bond covering maximum disclosed charges, and borrower and House count
and amount caps. Charges stop at readiness or the accepted setup deadline; unused
bond is refunded without releasing the ready facility's commitment. Abandonment
and expiry apply the accepted charges and bounded repeat penalties. Governance
can attest a protocol setup failure with an evidence hash, giving a full refund.
Bond custody stays in HouseVault's separate bond accounting until settlement.
Sponsor funding requires a single-use onchain grant binding the Credit, borrower,
vault, policy, refund recipient, amount cap, and expiry. SDK acceptance can use
`sponsor_wallet` and `sponsor_cap`, or an existing valid grant and token allowance.
House policy versions increase monotonically; configured risk terms cannot be
changed within a version.

`CreditApp.review()` simulates the complete action through `Core.previewPlan`
and displays the resulting debt, recoverable value, and health threshold. The
simulation always reverts its state changes. Actual execution repeats the
checks with the borrower's signature and enforces post-action health. During
liquidation, an approved keeper calls `recoverApp` through the bundle's pinned
adapter and registered recovery call, then repays recovered account cash to
HouseVault. Freezing new app actions does not disable a reviewed recovery call.
Each admitted bundle registers an `IExecutionPolicy` and its pinned state reader.
Core executes at most eight calls as the Credit Account, with exact approvals
reset after each call. `ExecutionManager` reserves portfolio and pending slots,
validates pending identifiers and recipients, and reconciles partial fills,
refunds, and cancellation races from authoritative app state. The action worker
submits changed accounting through the durable keeper journal. Reconciliation
records an external fill during a health outage and blocks new risk until fresh
health clears it; an exposure breach remains blocked. Refunds do not reduce debt.
Scoped sessions bind capabilities, markets, individual and aggregate spending
and exposure, expiry, and the Credit's session generation. The primary wallet
configures or revokes them onchain. Execution reports pending IDs from receipt
events, and closure reconciles changed pending state before unwinding.
`credit.execute()` waits for finalized execution and reconciled pending outcomes.
The SDK saves the transaction checkpoint before waiting, exposes fills, refunds,
remaining exposure, and terminal status, and reports cancelled partial fills as
`partial`. A timeout carries an `ExecutionPendingError` checkpoint;
`credit.app.resumeExecution({ checkpoint })` resumes that transaction without
another draw or action signature. Reconciliation transactions are bounded per
run, and the modal persists progress and resumes pending actions after reopening.
Each integration still needs a concrete reader and adapter for its deployed app.
An application reader must implement `IAppStateReader` to enumerate at most
32 current positions and 32 pending actions for a Credit Account. The server
reads that state at one finalized Monad block through the bundle's pinned
`AppHealthReader`; an unavailable, stale, changed, or incomplete reader returns
`application-state-unavailable` instead of an empty list.
It must also implement `IAppCashReader.reservedCash` for settlement cash owed
to pending orders or other application liabilities. Core reads free cash
separately from price-dependent health, so oracle staleness alone does not block
repayment. `IAppExitPlanner` supplies bounded, revision-bound unwind steps.
`credit.close()` freezes the facility before unwinding, repays actual free cash,
returns surplus, and waits for verified source return before resolving. Its
checkpoint supports resumption after wallet or network interruption.
An integration can offer `credit.close({ mode: "retain" })` by registering an
immutable `AppRetentionVerifier` before its first accepted Credit. The verifier
requires no debt or pending orders, no reserved settlement cash, and a fresh
ownership reader proving that positions stay account-owned, application control
has been revoked, and remaining obligations cannot claim House assets.
An optional pinned `IAppRetentionPlanner` supplies bounded cancellation, settlement,
or ownership migration steps verified through the registered safe recovery calls.
Retention freezes the facility and sessions, requests any repayment shortfall,
and never invokes the unwind adapter. Core repeats verification before collateral
return and account release. A retention request does not bypass liquidation exit
checks. The modal discloses support with the offer and preserves the selected mode.

`credit.reviewRepayment()` returns current debt, a bounded payment cap, and expiry.
`repay({ amount: "max" })` recalculates debt when the transaction executes and
requires the cap to cover it. Core transfers only the debt due; the SDK reports
the actual repayment event and clears unused wallet approval. A delay or increased
debt beyond the cap needs a fresh review. Account repayment uses verified free
cash, excluding pending or senior application liabilities.
Once closure completes, the Credit Account releases control to its borrower and
Core can no longer execute from it. A fully repaid liquidated account can be
released with `credit.account.release()` after custody and exit reconciliation.
The SDK reads current health at a single finalized block rather than displaying
the last stored risk snapshot.

`credit.collateral.add({ amount })` tops up an existing ready facility. Local
MON or ERC-20 deposits count atomically. Remote WETH and SOL top-ups bind an exact
owner-funded delta, lock, nonce, and deadline and count only after verified source
confirmation. Old deposit proofs cannot restore collateral already withdrawn.

Remote withdrawals reserve collateral before publishing a release authorization.
Reserved amounts immediately stop backing debt and draws. Confirmation cannot
subtract them twice; only verified nonexecution after expiry restores backing.
Closure and recovery wait for unresolved top-ups and releases. Both SDK methods
await finalized completion and save resumable checkpoints, exposed through
`resumeAddition({ checkpoint })` and `resumeWithdrawal({ checkpoint })`.
Source relays confirm funded top-ups or expire unused ones without spending the
collateral owner's funds.

House withdrawal requests retain shares until FIFO redemption and remain exposed
to gains and losses. Share conversion includes bounded pending loan accrual net
of protocol fees. Partial recovery retains the suspended commitment; full
termination and maturity release it. House managers finalize exhausted local
recovery through `HouseVault.finalizeRecovery`. Unpaid debt remains a contingent
claim after write-off. `RecoveryReserve` escrows borrower/sponsor first loss,
underwriter first loss, and House reserves outside LP NAV. Later recoveries first
restore the affected LPs, then consumed reserves and first-loss funding. LP claim
rights use economic share checkpoints, including queued shares, and survive
withdrawal. New LPs do not receive recoveries for earlier write-offs. Conversions
pause while a per-credit impairment awaits resolution.

Workers require `CORE_DEPLOYMENT_BLOCK` from the deployed Core receipt. The
finalized event index uses renewable leases and canonical block checkpoints,
discovers Credits without a client tracking request, and advances only after
durable event storage and projection refresh. RPC gaps are retried; a changed
indexed finalized block halts that cursor for operator investigation. `/health`
reports process liveness; `/ready` checks database access, chain identity, and
recent index progress. Monitor `/ready` and worker error logs in deployment.

The risk worker scans up to 64 active Credits per pass, independently of proof
relays. It uses finalized debt, authoritative health and onchain thresholds;
simulates each mutation; and advances default, app exit, free-cash repayment and
remote seizure through the existing plugin interfaces. `RISK_KEEPER_KEY` must
belong to an approved recovery keeper. Without that key the monitor is read only.
Nonsettlement local collateral requires a buyer through the reviewed sale policy.
House managers retain authority to finalize losses.

`RECOVERY_RELAY_KEY` on Monad and `SOURCE_RECOVERY_RELAY_KEY` on Ethereum relay
destination settlement VAAs to source recovery custody. They must use distinct
wallets from other workers on the same chain. Route registration and destination
settlement have separate proof domains. Source clearance binds the latest
seizure, empty held custody and completed routes before finalization. Funded SOL
routes clear after destination allocation; an expired fully refunded route can
consume its original funding amount from the verified cumulative refund budget
once. This accounting does not identify a particular provider refund transfer.
Late deliveries and source refunds remain controlled claims, and above-cap
inbox proceeds can repay debt without increasing the receipt authorization cap.
Borrowers can submit a clearance proof through `credit.confirmRecoveryClearance`;
SOL requires the source snapshot transaction signature.

Risk, settlement, recovery-delivery and Ethereum snapshot transactions persist
their signed payload before broadcast and reconcile canonical finality. An
independent loop resumes persisted transactions after a restart, even when the
original action is no longer eligible. A stuck transaction can be replaced with
a separately signed fee bump:

```sh
cd server
node --import tsx scripts/replace-keeper-tx.ts 143 <keeper-wallet> <signed-transaction-file>
```

The replacement must preserve its sender, chain, nonce, call, value, gas and
authorization fields. Both fee components must rise by at least 20 percent.
The worker retains at most four replacements and accepts whichever candidate
finalizes. Raw signed transactions and private keys are not command output.

`COLLATERAL_MARKETS` publishes the admitted source-wallet choices in the modal.
It is a JSON array of EVM entries (`id`, `label`, `decimals`, `chainId`,
`rpcUrl`, `asset`, `vault`, `controller`, `nativeVault`) or Solana entries
(`id`, `label`, `decimals`, `chainId`, `rpcUrl`, `genesis`, `asset`, `program`).
The catalog checks each entry against finalized Core market bindings. Apps
that support SOL provide a `sourceWalletResolver` in SDK configuration to
connect their Solana wallet adapter; the borrower chooses that wallet in the
modal.

`scripts/deploy.sh` takes one stage and one RPC. `protocol`, `routing`,
`ethereum-beacon-client`, `ethereum-verifier`, `ethereum-wormhole-verifier`, `native-collateral`,
`collateral-health-reader`, and `app-health-reader` require
Foundry 1.8 or newer, the Monad RPC, and `MONAD_CHAIN_ID`. The wrapper selects
Monad execution. `source` and `source-wormhole` require the Ethereum mainnet RPC,
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
registry. For the Wormhole Ethereum route, deploy `source-wormhole` to create
the Ethereum custody contracts, Monad VAA verifier, and Ethereum snapshot
publisher. The source stage checks the Monad Core, HouseVault, and inbox factory
bindings at a Verified block using `MONAD_RPC_URL` and their reviewed runtime
code hashes; that RPC must serve historical state. Bind
`SourceRecoveryVault.setController(controller)`, then deploy
`ethereum-wormhole-verifier` on
Monad with the finalized publisher, vault, and controller code hashes. Configure
the Monad Wormhole Core in `TermbookCore.configureEthereumWormhole` and
`InboxFactory.configureEthereumWormhole`, admit the Ethereum verifier, bind
the market, and unpause the source controller. The publisher checks the vault's
lock commitment or the controller's executed or expired action before
publishing. The receiving verifier pins the emitter and message type. This
route trusts Wormhole's Guardian quorum.

### Optional native consensus route

The selected ETH and SOL deployment uses Wormhole. The following route is an
optional consensus-client alternative.

The native consensus route uses `source` and `ethereum-verifier`. The `source`
stage deploys the Monad verifier, recovery vault, and controller on Ethereum;
the controller creates its collateral vault. Bind
`SourceRecoveryVault.setController(controller)` after deployment. Deploy
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

For Monad-to-Ethereum proofs, deploy `MonadEpochCommitter` on Monad and call
`commitNextEpoch()` during each epoch boundary delay. The Ethereum
`MonadBftLightClient` learns the next validator set only from a finalized
receipt of that event. Its bootstrap block and initial validator set require
independent verification. A Monad consensus node must supply native headers,
quorum signatures, and execution headers for the proof relay.
For Ethereum events older than the latest finalized Beacon block,
`fetchFinalizedBeaconBlock` accepts a Lodestar-backed state prover origin. It reads
`/state_proof` and `/block_proof` for the exact finalized checkpoint and event
block and verifies both SSZ branches. A relay must submit the resulting calldata
to the Ethereum light client on Monad before those event proofs can be used.
With a Lodestar-backed state prover running, set `ETHEREUM_BEACON_PROOF_URL` to its
origin and run `pnpm --dir server relay:ethereum-beacon-block <slot>
<checkpoint-root>` for a finalized block that needs historical admission.

## Collateral markets

Termbook's settlement asset is set per HouseVault. A USDC House can accept a
different collateral asset only when the market has a verified lock, a fresh
USDC price, a recovery route, and the required governance configuration.

| Asset | Lock location | Current implementation |
| --- | --- | --- |
| MON | Native MON enters `NativeCollateralVault` on Monad and is held as WMON. | Local custody, native return, WMON sale for USDC, and oracle-backed collateral-only health reader. Requires reviewed WMON and USDC deployments, feed, risk bands, exit verifier, and market admission. |
| ETH | WETH stays in `CollateralVault` on Ethereum. | The Wormhole route publishes Ethereum custody snapshots and Monad action authorizations as Guardian VAAs, with pinned emitters and payloads verified onchain. The native Beacon and Monad BFT verifier contracts remain available as a separate route. The Wormhole route still needs deployment and live lock, return, seizure, and recovery tests before accepting funds. |
| SOL | Native SOL stays in a Solana program-derived account. | Monad publishes lock and action authorizations through Wormhole. The Solana program verifies posted VAAs and emits custody snapshots through the Wormhole shim; Monad verifies signed snapshot VAAs. The SDK connects a browser Solana wallet and posts VAAs; immutable program deployment and live recovery tests are still required. |

For SOL, Monad Core binds the lock and publishes its Wormhole authorization
before a Solana wallet signs the SDK `SolanaSourceLockWallet` lock instruction.
Each Monad authorization must include the current Wormhole Core `messageFee()`;
the SDK supplies it for borrower binding and return transactions.
The wallet adapter posts the authorization VAA to Solana. The SDK tracks the
finalized lock signature with `POST /collateral/solana`; the server fetches its
signed snapshot VAA and verifies it on Monad. Set `SOLANA_PROOF_URL` to the
WormholeScan API origin (`https://api.wormholescan.io` on mainnet) for
signature-based lookup. After a Core return or
seizure authorization, an actor obtains
`POST /collateral/solana/actions/plan`, submits that exact instruction on
Solana, then obtains `POST /collateral/solana/actions/confirmation-plan` to
confirm the finalized source action or cancellation on Monad. Confirmation
requests must supply the finalized Solana `sourceTx` signature for VAA
lookup. These endpoints require an admitted Wormhole-backed verifier for the
pinned Solana program. After a confirmed seizure, a recovery keeper can
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

The worker relays finalized SOL return and seizure authorizations without the
borrower's wallet. Configure `SOLANA_SOURCE_KEEPER_KEY_FILE` with the fee payer's
64-byte keypair JSON, `SOLANA_RPC_URL`, `SOLANA_PROOF_URL`,
`SOLANA_COLLATERAL_KEEPER_KEY` for Monad confirmation, and `WORMHOLE_SCAN_URL`.
`SOLANA_SOURCE_MAX_TRANSACTIONS` bounds each authorization's transaction budget
(default 64). The relay checks the finalized network and immutable program hash,
journals signed transactions before broadcast, reconciles them after restart,
and confirms the signed custody snapshot on Monad. Expired authorizations use
verified cancellation snapshots; a timeout alone does not release collateral.

The Solana program pins Wormhole Core and the emission shim. `Lock` checks its
executing program and ProgramData accounts and rejects an active upgrade
authority. The shim accounts are payer, bridge, message, emitter, sequence, fee
collector, clock, system program, Wormhole Core, event authority, and emission shim.
`CheckpointLock` and `CheckpointRecovery` publish fresh custody snapshots without
repeating a completed transfer. `ReconcileRecoveryRefund` records only SOL
actually returned to the recovery PDA.

Before admission, remove the program upgrade authority and run:

```sh
node --import tsx server/scripts/verify-solana-program.ts <rpc-url> <program-id> <genesis-hex> <program-data-hash>
```

Use the verified program and emitter values to deploy `WormholeSolanaAccountClient`
and admit `SolanaVerifier`. Run `(cd contracts/solana && cargo build-sbf --offline)`
to build `contracts/solana/target/deploy/sol_collateral.so`.
On an isolated validator loaded with that program, run
`node scripts/check-solana-runtime.mjs http://127.0.0.1:8899 <PROGRAM_ID>` to
verify program loading, instruction decoding, Clock, PDA derivation, Keccak,
and rejection of an unverified lock. The check accepts loopback RPC URLs only.
Preserve the ignored `sol_collateral-keypair.json` to retain the program ID.
The local SBF smoke test checks invalid bindings against a loaded program;
the live deployment exercises the actual Guardian and routing paths.

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

Borrowers can call `credit.app.exit(instruction)` with their integration's
recovery-adapter instruction to cancel or unwind without another draw. Core
checks the same pinned adapter, registered recovery call, and verified outcome
used by keeper recovery. This path remains available while paused, after
maturity, or while closing; a specifically disabled recovery call still fails.
Ordinary app actions stop at maturity. An exit does not authorize a withdrawal
to the borrower or skip the separate repayment and collateral-return checks.

## Payment completion

`credit.repay()` and `house.account(owner).deposit()` wait for finalized House
accounting. Local results use the transaction's allocation or minted shares.
Remote payments use a registered inbox; receipt alone creates no debt reduction
or shares. Source funding supports admitted EVM ERC-20/native routes and native
SOL routes. The source wallet may differ from the Monad wallet and must match
the reviewed source refund recipient.

Use `settlement.routes()` to read configured routes. Non-recovery route entries
include a public `sourceRpcUrl`, `sourceKind` (`erc20` or `native`), and, for SOL,
`sourceGenesis` and `sourceAddressFormat: "solana"`. The quote, operation digest,
source transfer, finalized inbox accounting, and source refunds are checked
before completion. Normal repayment overflow cannot authorize payment above
its receipt cap; excess is returned to its bound recipient.

Payment options accept `signal`, `timeoutMs`, `onProgress`, `onLocalProgress`,
and a `sourceWallet` or client `paymentWalletResolver`. Browser checkpoints are
saved automatically. `PaymentPendingError` and `LocalPaymentPendingError` carry
the saved operation. Resume with `credit.resumeRepayment(checkpoint)`,
`credit.resumeLocalRepayment(checkpoint)`, `house.account(owner).resumeDeposit(checkpoint)`,
or `house.account(owner).resumeLocalDeposit(checkpoint)`. Resuming verifies the existing
transaction and authorization rather than creating another payment. Solana
signed transfers are saved before broadcast and can be rebroadcast until their
blockhash expires. An unfunded expired quote raises `PaymentExpiredError`.

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
`RECOVERY_ROUTE_SIGNER_KEY`, `RECOVERY_RISK_SIGNER`, and `RECOVERY_FUNDING_KEY`
are configured. The two signers must use different accounts.
The risk signer reads `/recovery/risk-approval-plan`, checks the quote and typed
data, then submits the signature through `/recovery/risk-approval`; its private
key stays outside the server. The worker checks the finalized factory operation
event, inbox, credit, admitted route, source vault, and signed quote before
funding. Source refund attribution requires the risk signer
to match the transfer with Aurora's operation; Aurora's origin transaction hashes
alone do not prove which refund belongs to an operation.

For the Wormhole Ethereum route, set `SOURCE_RPC_URL`, `WORMHOLE_SCAN_URL`,
`SOURCE_WORMHOLE_PUBLISHER_KEY`, `MONAD_WORMHOLE_PUBLISHER_KEY`, `COLLATERAL_KEEPER_KEY`,
`SOURCE_ACTION_KEEPER_KEY`, and `MONAD_CONFIRM_KEEPER_KEY`. The publisher key
must be distinct from the source action and collateral keeper keys. The worker
publishes lock, applied action, and expired unconsumed action snapshots on
Ethereum and relays their VAAs to Monad. Monad authorizations and recovery
operation registrations publish VAAs for the source controller and recovery
vault. Those authorization and registration transactions must include the
current Monad Wormhole Core `messageFee()`. `WORMHOLE_SCAN_URL` is the API origin, such as
`https://api.wormholescan.io`; Wormhole Core verifies the VAA onchain.

For the native route, the Ethereum collateral proof worker needs `SOURCE_RPC_URL` with historical
`eth_getProof` support, `COLLATERAL_KEEPER_KEY`, and `ETHEREUM_BEACON_API_URL`.
It reads the standard Beacon finality update for the current finalized execution
block and checks the Beacon branches, canonical Ethereum block, storage proof,
and Monad verifier before relay. The source action worker uses
Monad `debug_getRawHeader` and `debug_getRawReceipts` for finalized
authorizations, with checked JSON receipt reconstruction as an RPC fallback,
and the Beacon API for
finalized Ethereum controller storage proofs. For an expired
seizure or return that was never executed, `POST /collateral/actions/cancel`
prepares a cancellation using a finalized Ethereum storage proof from the
current Beacon update. Applied actions are confirmed from the controller's
permanent consumed flag, which is set atomically with the source vault transfer.
On the native route, Monad authorizations require consensus witnesses and a relay.
Monad receipt proof generation waits until the source block
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

Ethereum remote collateral can use the Wormhole Guardian route described above
or the separate native consensus route. SOL uses Wormhole Guardian attestations.
After deploying the source
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
For the optional native consensus route, the Ethereum source verifier proves
the `lockCommitments(lockId)` storage value against a finalized Ethereum state
root and binds the admitted vault and all lock fields. The source action proof
binds `RemoteActionApplied` to the exact authorization hash; the Monad proof
binds `RemoteActionAuthorized` to the same hash and the configured Core emitter.
The selected Wormhole route verifies the bound custody and action commitments
in Guardian-signed messages. Live route approvals and deployed asset configuration
must be supplied during deployment. Route liquidity limits and a
live cross-chain recovery drill are required before accepting production funds.

### Keeper scan capacity

Risk and asynchronous-action monitors use independent database leases and bounded
credit-ID shards. `RISK_SCAN_SHARDS` is a power of two from 1 to 256;
`RISK_SCAN_PAGE_SIZE` defaults to 128 (maximum 1024),
`RISK_SCAN_CONCURRENCY` defaults to 8 (maximum 32), and
`RISK_SCAN_MAX_AGE_MS` defaults to 120000. Run additional worker instances and
choose these limits for the admitted portfolio sizes and RPC capacity. Cursor
advancement is fenced by the lease; another worker can resume an expired lease.
The readiness endpoint requires recent complete risk and action scan cycles
when active Credits exist. Stale cycles also emit `risk-scan-lag` errors. Monitors
read finalized Core state and simulate eligibility before journaled submissions.
Remote source actions apply retry backoff and schedule by next-run time, so an
unavailable proof or unfunded top-up cannot repeatedly occupy the first batch.

### Recovery route shortfalls

A route can return source collateral and deliver only part of its quoted
settlement-token minimum. Proceeds are still allocated to the bound House claim.
An incomplete minimum stays pending while the keeper retries or reconciles refunds.
After the operation deadline plus one hour, the House manager may explicitly
accept the shortfall through `HouseVault.acceptRecoveryShortfall(operationId,
expectedAccounted)`. The factory requires empty inbox custody and the exact
reviewed allocation, records the nominal minimum shortfall, and completes the
operation without reducing debt or cancelling later recovery claims. ETH's
completion VAA can then clear source delivery state. SOL's refund balances remain
controlled by the recovery PDA and are available for a new recovery operation.
Source clearance, cure and write-off retain their independent checks.

The SDK exposes `house.recovery_operation(operationId)` as a finalized snapshot
and `house.accept_recovery_shortfall({ operation_id, expected_accounted })` for
the House manager. Late destination receipts continue repaying the same credit;
late source refunds remain attributable to the original recovery operation.
Keepers cannot accept a shortfall or manufacture repayment from a provider status.
