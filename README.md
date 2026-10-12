# Termbook

Credit inside applications on Monad. Borrowers lock collateral on a supported
chain and draw funds from a House through a restricted Credit Account.

See `termbook.md` for the required behavior specification.

## Documentation

Run `pnpm dev:client` and open `http://127.0.0.1:4178/docs` for the developer
guides, integration interfaces, Kuru example, SDK reference and operator setup.
Content lives in `client/src/features/docs/content/` with links and action
examples checked by the client test suite.

## Layout

- `contracts/evm/` Foundry project for Monad and Ethereum contracts
- `contracts/evm/src/monad/` contracts deployed on Monad
- `contracts/evm/src/ethereum/` contracts deployed on Ethereum
- `contracts/evm/src/shared/` code compiled into either EVM deployment
- `contracts/solana/` native SOL custody program
- `packages/bindings/` generated contract ABIs and deployments
- `packages/schema/` shared request and response schemas
- `packages/sdk/` borrower and LP client
- `server/src/kuru/` Kuru spot integration using the SDK's standard interface
- `server/test/kuru/` Kuru regression and lifecycle acceptance tests
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

## Local testnet services

`docker compose -f docker-compose.testnet.yml up -d` starts an isolated MongoDB
replica set on port 27018 and Redis on port 6380. Configure the server in the
ignored `.env` with the current deployment addresses and
`CORE_DEPLOYMENT_BLOCK`, then build the workspace and run these in separate terminals:

```sh
node --env-file=.env server/dist/server.js
node --env-file=.env server/dist/worker.js
```

Use `mongodb://127.0.0.1:27018/termbook_testnet_upgradeable?replicaSet=rs0&directConnection=true`
with a one-member `rs0` replica set for integration admission transactions.
MongoDB stores its data in the `termbook-testnet_mongo` volume managed by Docker.
Set `ENVIO_API_TOKEN` in the root `.env` to use Envio HyperSync for Core event
indexing. The endpoint defaults to `https://<MONAD_CHAIN_ID>.hypersync.xyz`;
`ENVIO_HYPERSYNC_URL` can override it. Monad mainnet and testnet are supported.
The worker scans up to 100,000 blocks per page, resumes from HyperSync's returned
boundary, verifies event data against RPC receipts, and checks canonical block
hashes through Monad RPC before advancing its durable MongoDB checkpoint.
It indexes only through the RPC's finalized head. An unavailable archive keeps
the checkpoint unchanged; without a token, the bounded RPC indexer is used.
Create a token in the [Envio dashboard](https://envio.dev/app/api-tokens).
An empty `REDIS_URL` uses the durable MongoDB queue. The local API uses port 3002. `/health` checks the API;
`/ready` requires current finalized indexing and healthy risk scans.

`node scripts/setup-testnet.mjs --simulate` runs feed admission, House policies,
and a 10 USDC LP deposit against a Monad testnet fork on port 18545. Use
`--broadcast` for the deployed testnet. The runner journals signed transactions
in `.data/operations` before submission. Completed setup is stored in
`deployments/testnet.json`, and its temporary journal is removed.
The initial ETH/USDC ratio uses admitted Chainlink ETH/USD and USDC/USD feeds, pins their
aggregators, and preserves the older observation timestamp. Its permissionless
`update()` must run when either underlying round changes. The testnet feeds have
a 24-hour heartbeat; this setup uses a 25-hour age limit for testnet exercises.
The worker refreshes pinned ratio feeds configured in `RATIO_PRICE_FEEDS` with a
distinct `ORACLE_KEEPER_KEY`; stale or invalid source rounds remain rejected.
The same keeper records authenticated execution-price checkpoints for admitted
app rules. `PRICE_REFERENCE_RULES` can prime configured rules before admission
using `{ bundle, capability, market }` hashes. Quotes use these checkpoints;
execution still verifies the current guarded price, deviation and slippage.

Health snapshots describe account state read at the current block. `OracleRegistry`
checks price freshness independently against each admitted feed's age limit;
price timestamps are preserved. Chainlink ETH/USD and USDC/USD retain their
25-hour testnet limits, while the existing MON/USD and SOL/USD Pyth adapters
reject prices older than 300 seconds. This configuration reads public onchain
feeds and does not require a new API subscription.

Run `node --env-file=.env scripts/setup-testnet.mjs --simulate --align-health`,
then the matching `--broadcast --align-health` after reviewing the simulation.
This copies the admitted collateral markets into a new immutable collateral
reader and installs its reader factory. Core keeps its existing address and
uses a 300-second snapshot limit. `SHARED_HEALTH_FACTORY` and
`SHARED_COLLATERAL_READER` bind the platform metadata; Kuru pins the collateral
reader in its next integration version. Setup verifies the factory's Core and
collateral-reader bindings. Existing versions keep their original readers.
Configure and validate the new Kuru version before issuing its app token.

Authenticated Pyth pull updates remain optional. `PYTH_API_KEY`,
`PYTH_PRICE_FEEDS` and `PYTH_HERMES_URL` configure signed updates with source
code, price ID, confidence and fee checks. The `--fresh-prices` migration can
replace ETH and USDC with pull feeds when that provider access is available.
Neither a keeper checkpoint nor a ratio refresh makes an old price fresh.
Price-dependent actions reject expired or invalid data; cash repayment remains
available. Production price-age policies require their own admission.
Refresh the existing price proxy with
`node scripts/setup-testnet-integrations.mjs --simulate --refresh-prices`, then
the corresponding `--broadcast` command after the simulation passes.

The upgradeable deployment installs the borrower-owned account factory and
`AccountHealthSource` before accepting any credit. This wrapper checks factory
provenance and identity before health or cash readings authorize funding.
`node scripts/verify-testnet-integrations.mjs` verifies their installed bindings
alongside the proxy and shared integration checks.
Production price-age and risk parameters require their own admission.

After app and keeper setup, `node scripts/testnet-e2e.mjs --begin` creates two
live Sepolia WETH credits. `--advance` executes verified-ready credits and
progresses repayment, collateral return, and default recovery; `--observe` reads
their current state. The current run stays in `.data/operations` until verification.
This uses a fully redeemable USDC reference app.
Expired setup cases are aborted and their collateral returned. `--retry-default`
creates a separate replacement credit with a 45-minute setup window; its default
test runs after maturity and grace. Fund each keeper for its maximum gas charge,
not just its expected fee. Workers check this before signing and retrying.
`--run` advances the cases every 45 seconds until repayment and default recovery
complete, with a two-hour limit. Only one runner may change the live journal.
`node scripts/verify-testnet-e2e.mjs` independently checks finalized state,
canonical receipts, fees, released account control and the approved keeper's
forced exit and repayment without requiring a signing key. A successful check
prints the result and removes the completed run files. It computes stage durations from canonical block timestamps and succeeds only
when both lifecycle outcomes and every listed receipt are finalized.
Aurora conversions and real trading venues require their own live exercises.

Local files have four purposes:

- `.env`: private service configuration, RPC URLs and API/signing keys.
- `.testnet/`: private wallet and program authority key files.
- `.data/`: temporary journals for unfinished operations.
- `deployments/testnet.json`: the active public deployment configuration, code pins and upgrade baselines.

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

### SDK integration flow

An integration exports the SDK's `spot`, `perps`, `vault`, `staking`, or
`liquidity` interface. It provides metadata and a pinned `definition`,
`account.read(context)`, supported `actions.<capability>.build(context)`, and
`exit.next(context)`. Readers return holdings and venue obligations at one
block; builders return bounded calls, spending limits, minimum receipts and
completion tracking. Exit returns an executable step, a wait, a failure reason,
or completion. Amounts use the asset's smallest units.
The published artifact contains the reviewed call definitions and code pins;
callback functions remain local. The modal uses that registered artifact, and
onchain modules determine custody, value and recovery.

The Termbook operator configures a `ValidationEnvironment` once. Its
`prepare` provisions the test facilities, funded House, distinct keeper and
unauthorized actors, and reviewed security scenarios. It supplies actual action,
recovery and repayment references plus one `ActionProbe` per execution route.
`create_validation_environment` runs a data program of reads, transactions,
simulations and assertions through the SDK recorder. App developers implement
their integration operations; they do not supply a `passed` flag or a keeper
wallet to `validate`. Validation resumes from the recorder's durable checkpoint.

After the application owner verifies its origin, the author flow is:

```ts
import { create_sdk, create_termbook, type spot } from "@termbook/sdk";
import { create_kuru } from "./server/src/kuru/integration.js";

const sdk = create_sdk({
  application_id,
  wallet: developer_wallet,
  api_base,
  validation_environment,
});

const kuru: spot = await create_kuru({
  client: public_client,
  api_base,
  market_address,
  settlement_asset: usdc,
  oracle,
  feed_id: token_usdc_feed,
  maximum_input: 1_000_000_000n,
  retained_bps: 9000,
  recovery_costs: 1_000_000n,
  max_holding: 1000n * 10n ** 18n,
  dust_limit: 1_000_000_000_000n,
});

const validation = await sdk.integrations.validate({
  plugin: kuru,
  wallet: developer_wallet,
  amount: 10_000_000n,
});
const registration = await sdk.integrations.register({
  validation_id: validation.id,
});

if (registration.status === "active") {
  const termbook = create_termbook({
    app_token: registration.app_token,
    wallet: borrower_wallet,
  });
  await termbook.open({
    action: {
      use_case: "spot",
      capability: "place_order",
      params: {
        market_id: kuru.markets[0]!.market_id,
        direction: "buy",
        order_type: "market",
        amount: { spend: 100_000_000n },
        slippage_bps: 50,
      },
    },
  });
}
```

`register` returns `awaiting_approval` until an authorized reviewer calls
`integrations.approve({ validation_id })`. The owner retrieves the activated
token with `integrations.status({ validation_id })`; active tokens can be resumed.
Validation IDs expire after 24 hours before activation. The server verifies
origin ownership, finalized receipts, recovery and repayment, code pins and
the deployed execution/accounting/recovery bindings. Registration cannot change
the tested definition. An upgraded dependency requires a new validated version.
SDK preparation checks pins; Core enforces policies and guards during execution.
The full lifecycle suite runs at admission.

The Kuru package declares market buys and sells with spend sizing, and limit buys
and sells with spend or receive sizing. Markets quote the House's USDC. The shared
router keeps market outputs in the Credit Account. Limit orders belong to that
account inside Kuru; the shared `SpotOrderTracker` captures their IDs, reconciles
fills and verifies cancellation refunds. The reader aggregates wallet balances,
venue balances and committed inputs before applying executable sell depth and
the independent oracle cap. Closure and keeper recovery cancel orders, withdraw
venue balances, sell holdings and settle debt. Bounded approvals are cleared in
the same transaction.
Approved dust limits use base-token units; dust has no credit value and stays
in the account when control returns to a debt-free borrower.
Kuru limit orders remain open until filled or cancelled. Requests containing
`expires_at` are rejected because this venue cannot enforce expiry. Intermediate
quote-asset routes are not declared. Existing atomic versions retain their rules;
limit actions require activation of the updated shared assessment version.

Operators deploy `ReadProgram`, `UseCaseReader`, `UseCasePolicy`,
`UseCaseRecovery`, `SpotOrderTracker`, `AtomicSpotRouter`, `AtomicSpotModule`, and
`AppHealthReaderFactory`. Configure `SHARED_READ_PROGRAM`,
`SHARED_USE_CASE_READER`, `SHARED_USE_CASE_POLICY`, `SHARED_USE_CASE_RECOVERY`,
`SHARED_SPOT_ORDER_TRACKER`, `ATOMIC_SPOT_ROUTER`, and `ATOMIC_SPOT_MODULE` with their addresses.
`await prepare_use_case` configures tracked spot orders; `prepare_atomic_spot`
configures immediate trades. Both produce governance calls for immutable routes,
dependency guards, amount/price rules, health accounting and activation. The health
factory binds the Core and collateral reader once; the plan creates the bound
`AppHealthReader` after registering recovery. Every proxy dependency needs a reviewed
onchain guard; an RPC implementation-slot check alone does not satisfy admission.
The shared components are deployed on Monad testnet. The MON/Circle-USDC Kuru
market passed operator validation and is admitted on testnet.
`node scripts/setup-testnet-integrations.mjs --simulate --refresh-spot` checks a
replacement of the immutable shared spot module; `--broadcast --refresh-spot`
updates its platform address after that simulation. Existing integration
versions keep their original module pins and require validation to move to the
new module.
`node scripts/setup-testnet-integrations.mjs --simulate --refresh-orders` checks
the `FlowExecutor` proxy upgrade and deploys the new immutable reader, policy,
recovery and order tracker. `--broadcast --refresh-orders` applies that plan.
The Core address stays unchanged. Existing facility and integration records are
checked before and after the upgrade. Configure and validate the new Kuru version
before issuing its app token.
The previously deployed atomic shared components have exact creation and runtime
source matches on Sourcify. Their addresses and source matches are in
`deployments/testnet.json`. Verify the new order components after deploying them.
The separate legacy Kuru-USDC House is configured there and remains unfunded.
The Circle-USDC market below uses the existing funded House. Verified sources,
reviewed guards and a passing lifecycle suite are required before an app token
can be issued.

On 10 October 2026, the official Kuru factory created a MON/Circle-USDC testnet
market at `0x1F57a841540fe23C2989387c18F2CB1335CBAe92`. The testnet operator
supplied 1 MON and 1 test USDC to its margin account and placed both bid and ask
liquidity. Its addresses and dependency pins are in `deployments/testnet.json`.
`node scripts/setup-testnet-kuru.mjs --simulate` checks setup on a current fork;
`--broadcast` resumes the live setup. The existing Circle-USDC House can fund
this admitted market.

Before admission, the testnet's explicitly trusted RPC monitor must cover all
six proxy dependencies, including Circle USDC's legacy OpenZeppelin proxy.
`setup-testnet-kuru.mjs` includes its guard in the setup. The SDK and server
pin the detected implementation slot, address and runtime code hash.
`TestnetUpgradeGuard` pins the reviewed proxy and implementation
code, accepts only its dedicated monitor's recent canonical-block attestations,
and expires after 180 seconds without renewal. The worker checks finalized and
latest implementation slots, then permanently revokes a guard on a detected
change. Its key and pinned guard list are configured as `UPGRADE_MONITOR_KEY`
and `TESTNET_UPGRADE_GUARDS` in the root `.env`. These guards reject deployment
and authorization outside Monad testnet (10143). An upgrade between monitor
checks remains a trust window; this configuration is not production admission.

Circle USDC, all five Kuru proxies, and the factory, margin-account, AMM-vault
and forwarder implementations now have published Sourcify runtime matches. The
source importer independently compares the compiled and live bytecode, allowing
only compiler-declared metadata and immutable substitutions for a non-exact
match. Full runtime hashes and implementation identities remain pinned. The
OracleRegistry implementation, proxy and its direct implementation guard have
exact matches, as do all six testnet monitor guards. Circle's linked
SignatureChecker library is verified with only its deployment-address call
protection and compiler metadata differing. These records are in
`deployments/testnet.json`. The admin-owned local Termbook Kuru application is
origin verified at `http://127.0.0.1:3000`.

The deployed OrderBook implementation at
`0x72caE0a99C19B574e8a6De558F43fc1D019c9374` still has no matching source build.
The public repository does not reproduce its executable bytecode. Testnet can
use a governance-signed runtime review bound to the exact proxy, implementation,
runtime hash, ABI, Core and a maximum trade of 100,000 raw USDC units (0.1 USDC).
The review expires within seven days and is explicitly marked unverified. The
monitor revokes its guard if the review expires, disappears or changes. This
exception is unavailable on mainnet or when the server runs in production mode.

The operator commands are:

```sh
node --env-file=.env scripts/setup-testnet-kuru.mjs --broadcast --review-runtime
node --env-file=.env scripts/setup-testnet-kuru.mjs --simulate --configure
node --env-file=.env scripts/setup-testnet-kuru.mjs --broadcast --configure
node --env-file=.env scripts/testnet-e2e.mjs --start --kuru
node --env-file=.env scripts/testnet-e2e.mjs --run --kuru
node --env-file=.env --import tsx server/scripts/validate-integration.ts validation.json --admit --approve
```

After the shared order upgrade and integration reconfiguration, use
`--start --kuru-orders` and `--run --kuru-orders`. This uses a separate journal,
tests all seven advertised actions, checks controlled venue balances, and
defaults a resting order for independent keeper cancellation and repayment.
The SDK admission runner selects the evidence for the configured version.

The shared order modules, FlowExecutor and the guarded-oracle PriceProtection
upgrade have exact Sourcify matches. The current reader-bound order configuration passed
simulation and all 142 configuration transactions confirmed on Monad testnet.
The seven-action version still requires live lifecycle tests and SDK admission.

Configuration binds the SDK definition and simulated governance plan before
broadcast. Reader registration targets `HealthSource`; the SDK checks its
binding through Core's authenticated `AccountHealthSource` wrapper. The live runner creates repayment, default-recovery and active
valuation facilities. It records actual buy/sell calls and independent keeper
recovery and repayment receipts for SDK validation. Live borrowing, buying,
selling, repayment, closure and independent keeper recovery completed on
10 October 2026. The deployment-bound SDK acceptance review passed and the
operator approved registration. `TERMBOOK_KURU_APP_TOKEN` is saved privately in
the root `.env`; `deployments/testnet.json` records its public admission identity.
The validation loans from that admission are closed, with no outstanding debt
and their collateral returned. Client work, service hosting and Aurora sandbox
routes remain deferred.
For local use, run the worker command above with funded monitor and oracle
keepers; execution checkpoints and monitor approvals expire when it stops.
Configuration also installs a generic code-hash guard for the immutable MON
ratio feed. The proposed 90,000-second Kuru health window was not activated.
The health freshness setup uses a 300-second state snapshot limit while
execution state and authorization limits remain 90 seconds. Feed-specific price
age limits are enforced independently. The new version still needs live lifecycle
validation and admission.
Optional `LOCAL_COLLATERAL_BIDS` entries bind `chain_id`, `collateral_asset`,
`settlement_asset` and `maximum_settlement` in raw token units. The recovery
keeper bids with its own funded settlement tokens, within the configured cap,
available funds, remaining debt and the onchain sale policy. Core checks the
independent price, receives the payment and transfers the purchased collateral.
Without a funded matching bidder, collateral recovery awaits a market bid.

The SDK fork acceptance runner implements all 36 applicable cases across the
16 admission requirements. It checks controlled custody, independent valuation,
unsafe-action rejection, repayment, final closure, isolated keeper recovery,
interruption and retry, and cure restrictions. Seven explicit exclusions cover
unsupported asynchronous orders, derivative reduction and retained positions.
Each rejection has a successful control; recorded observations, transactions
and simulations are replayed against their original blocks.
All 36 cases passed and replayed using the deployed Termbook contracts on a
local fork. The SDK checked the live trading, custody, valuation, repayment and
independent recovery receipts before registration and approval. Admission uses
the testnet runtime review and expiring upgrade monitors described above.

Build the Solidity fixtures, start a local fork, then run the SDK suite in a
second terminal:

```sh
forge build --root contracts/evm
anvil --fork-url https://testnet-rpc.monad.xyz --chain-id 10143 \
  --host 127.0.0.1 --port 18548 --slots-in-an-epoch 1 \
  --disable-code-size-limit --gas-limit 30000000 --timeout 30000 --retries 3 \
  --max-persisted-states 20000
```

```sh
pnpm --filter termbook-server test:kuru
```

The runner accepts only a local Anvil fork. It uses public fixture keys, local
Termbook contracts, controlled prices and fork-only funding and adverse state.
Its report is written to a temporary directory and marked diagnostic and
`not_admitted`. This validates the shared protocol against Kuru's actual
deployed bytecode. For admission, restart the fork after live configuration and
lifecycle testing, then run:

```sh
node --env-file=.env --import tsx server/test/kuru/run-acceptance.ts \
  http://127.0.0.1:18548 --deployment
```

This mode keeps the actual Core and shared platform deployments. Fork-only
prices, funding, helper contracts and adverse states are labelled as fixtures;
Core and manifest dependencies must be pinned to canonical chain code. The SDK
replays safety evidence on the local fork and checks the plugin and real loan
receipts on Monad. An authorized operator signs the fork review before admission.

The Kuru fork suite exercises borrowing, native MON custody and valuation,
market buys and sells, repayment, borrower closure, and keeper recovery through
the deployed market's actual bytecode. It also checks insufficient exit depth,
expired monitor approval and changed implementation code:

```sh
KURU_FORK_RPC_URL=https://testnet-rpc.monad.xyz KURU_FORK_BLOCK=69773398 \
  forge test --root contracts/evm --match-contract KuruForkTest -vv
```

These tests use fork-only balances, local Termbook deployments and a controlled
price feed. They skip when `KURU_FORK_RPC_URL` is absent. They do not replace the
SDK's admission suite, production oracle checks or live testnet receipts.

### Shared assessment

App developers implement TypeScript interfaces for `spot`, `perps`, `vault`,
`staking`, or `liquidity`. Their native ABI calls and reads are compiled into an
immutable definition. Integrating developers do not deploy a venue-specific
Termbook contract. Kuru-specific selectors, precision and depth decoding live in
`server/src/kuru`; Solidity enforces the shared rules.

`prepare_use_case(definition, operator_config)` prepares governance calls for the
shared reader, policy and recovery components. The server checks their addresses,
configuration hashes, price rules, code pins and read programs against the tested
version before activation. `assess_state` compares the TypeScript state with
native reads at the same canonical block. Action-specific constraints bind call
order, selectors, constants, spending, the Credit Account and credit ID.

| Use case | Shared valuation and exit rules |
| --- | --- |
| Spot | Controlled balances, pending liabilities, executable sell depth and oracle caps; cancel, withdraw and sell remaining holdings. |
| Perps | Margin capped by independently valued backing, plus signed PnL minus liabilities and executable close caps; cancel and close positions. |
| Vault | Underlying assets, shares and withdrawal claims; redeem and claim into the Credit Account. |
| Staking | Stake, rewards, withdrawal claims and unbonding deadlines; request exit and claim when available. |
| Liquidity | Both underlying assets, liquidity and rewards; remove liquidity, collect and convert remaining assets. |

Amounts are raw token units. Margin, notional, liabilities and recoverable value
use settlement-token units. PnL is signed. Oracle feeds quote the asset in the House settlement token,
scaled to 18 decimals. Market names map to their keccak256
hashes; native object IDs are bytes32 or unsigned integers. A withdrawal request
lists its market, underlying assets, liability, recoverable value, claim time and
optional replaced position. The reader rejects simultaneous counting of that
position and its withdrawal claim. Claims available after loan maturity have no
positive credit value. Reserved settlement cash is excluded from spendable cash.

The bounded read format normalizes native getters to these ordered outputs:

| Read | Outputs |
| --- | --- |
| Metadata | owner, position count, pending count, request count, reserved settlement cash |
| Position | owner, ID, market, quantity0, quantity1, rewards0, rewards1, margin, notional, signed PnL, liability, executable value, shares, staked, liquidity, claim time |
| Pending/reconciliation | owner, ID, position ID, committed, filled, refunded, remaining, maximum exposure, liability, maximum liability, deadline, reserved position slots, refund recipient, status |
| Withdrawal | owner, ID, market, quantity0, quantity1, liability, executable value, claim time, replaced position ID |
| Tracked spot order | owner, remaining input, remaining base quantity, price, buy flag, active flag |
| Venue balance | owner, available balance |

Programs contain bounded static calls and arithmetic, checked return sizes and
optional immutable parameter hashes. Every queried dependency is pinned. Native
getter semantics and recovery calls still require source review and lifecycle
validation; an ABI alone does not establish custody or economic meaning.
Unpriced assets and unverified claims cannot provide credit backing.

Recovery checks actual proceeds, bounded spending, state progress and portfolio
value. It clears approvals in the same transaction. The modal requests approved
steps; the shared contracts enforce them. Asset valuation caps limit credited
value; excess donated tokens remain recoverable through bounded exit steps.
The Kuru package covers market trades, resting limit orders and cancellation
quoted in House USDC. Other declared operations
need matching native reads, call rules and validated recovery steps. Monad testnet's
`FlowExecutor`, `AccountFactory`, `PriceProtection`, and Core have been upgraded
for these versions. Existing immutable Credit Accounts retain their old code and
use their existing recovery adapters; newly funded recovery calls need new accounts.
The admitted atomic version has completed live lifecycle validation. The tracked
order version requires its own deployment-bound acceptance report and live tests.

### Transaction-reference admission

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

For local Monad testnet E2E, `LOCAL_APP_ORIGINS=http://127.0.0.1:3000` explicitly
allows that exact loopback origin. Its owner must be an `ADMIN_WALLETS` signer,
and registration returns `verification.method: "local_operator"`. The signed
origin-verification endpoint activates it without DNS. Removing the allowance
or admin ownership disables admission. This option is rejected on mainnet and
when `NODE_ENV=production`; public origins continue to require DNS verification.

The owner submits a reviewed `category`, `versionId`, `codeHash`, settlement
asset, `actions`, and `verifiedSources` to
`POST /integrations/candidates/:id/mapping`. Each action names its approved
target, ABI function, and argument source (`input`, `borrower`,
`credit_account`, or `credit_id`). Perps mappings must include placement and
closure. The candidate stays inactive in `ready_to_test` until the owner submits
an `acceptance` record to `POST /integrations/candidates/:id/evidence`. It
includes the complete `suite`, its canonical `evidenceHash`, active and recovered
Credit IDs, one actual Core action transaction per declared execution route, recovery
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
node --import tsx server/scripts/validate-integration.ts validation.json
```

The JSON config contains `rpcUrl`, `suite` metadata, `module`, `parameters`,
`gasLimit`, `checkpoint`, and `output` paths. The reviewed module exports
`createScenarios(parameters, actors)` returning named `cases` and justified
`exclusions`. Cases call the recorder's `observe`, `simulate`, `transact`, and
`assert` methods. Rejection simulations use the successful control's exact
canonical block, even when the finalized head advances. Use the actual supported
account and role model at minimum and maximum supported sizes. Set `TERMBOOK_VALIDATION_BORROWER_KEY`,
`TERMBOOK_VALIDATION_KEEPER_KEY`, and `TERMBOOK_VALIDATION_UNAUTHORIZED_KEY`
for the three distinct wallets bound in the suite metadata. The runner saves
state and submitted transaction hashes before waiting for finality; rerunning
resumes the same case and transaction. `create_evidence_environment` connects a
completed report to the author SDK, rechecking its canonical reads, transaction
inputs, receipts, actual gas limits, simulations and assertions. It requires the
full reviewed report and live lifecycle references; it does not create cases or
replace live testing. The CLI's `--admit` mode uses the same SDK validation,
registration and optional `--approve` flow. Its `admission` config contains the
verified `applicationId`, `apiBase`, plugin `module` and `factory`, factory
`parameters`, tested `amount`, live `lifecycle` file, and a `tokenEnv` matching
`TERMBOOK_*_APP_TOKEN`. The activated token is written to root `.env` and is not
printed. Before activation, `--approve` is restricted to the server's authorized
reviewer; fork reports also require the bound review signature. The server records
`validating` with a renewed lease, rejects concurrent submissions, and restores `ready_to_test` with
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
`LinkedLibraryGuard` pins an implementation and its fixed external Solidity
libraries, rejecting further library delegation. Review must establish that every
delegate target is a fixed registered library; mutable targets need a custom guard.
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
builds calldata from this manifest; an app passes `use_case`, a capability, and
typed parameters to `open({ action })`. `use_case` is `spot`, `perps`, `staking`,
`vault`, or `liquidity` and must match the integration resolved by the app token.
Capability names remain shared: both spot and perps can use `place_order`.
The SDK and API reject a mismatched use case before authorization or funding.
Actions that omit the field infer it from their registered integration and still
use the standard parameters. The complete catalogue is in
[termbook.md](termbook.md#standard-action-parameters). Spot exposes `place_order`,
`modify_order`, and `cancel_order`; buy/sell, market/limit, and spend/receive are
inputs to those operations. Public swap-specific capability names are not admitted.
Each published mapping must consume the standard inputs. Unknown fields,
unsupported sizing modes, mixed spend/receive amounts, and invalid protection or
expiry values are rejected before authorization. SDK action types are discriminated
by use case and capability.
For example, the capability mapping is:

```json
{
  "capability": "place_order",
  "label": "Place order",
  "when": { "order_type": "market" },
  "target": "0x0000000000000000000000000000000000000001",
  "signature": "function placeOrder(uint256 market,uint8 direction,uint8 orderType,uint256 margin,uint256 notional,uint256 priceBound,address account)",
  "arguments": [
    { "source": "input", "path": "market_id", "label": "Market ID in base units" },
    { "source": "input", "path": "direction", "choices": { "long": "1", "short": "2" } },
    { "source": "input", "path": "order_type", "choices": { "market": "1" } },
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
Multiple routes may share a public capability. Their `when` conditions select
`market_id`, `direction`, `order_type`, and/or `sizing` (`spend` or `receive`).
Conditions must be disjoint. Each route has a distinct `executionKey`, used by
the onchain policy, price rules, session permissions, and acceptance evidence;
the borrower continues to call the public capability. The default key is the
capability name when it has one route. Every route needs its own executed sample
and approval. Checkpoints retain the selected execution key when resuming.

Market spot routes use `min_output` for spending budgets and `max_input` for
receipt targets. Limit routes are asynchronous, map `expires_at` to the actual
application deadline, and encode the signed `limit_price` through `price_bound`.
They omit `price.slippagePath`. The price must be at least as protective as the
House and integration oracle bound. `orderSizing` declares `baseAsset`,
`quoteAsset`, `baseDecimals`, `quoteDecimals`, `feeBps`, and `lotSize`.
`_derived.order_quantity` and `_derived.order_spend` are computed privately;
callers cannot submit them. Budgets round quantity down after the fee reserve,
while quantity and proceeds targets round up to a lot. Decimals and asset
dependencies are checked onchain during admission. Application validators and
acceptance tests must establish the fee cap and limit-order semantics.

Perps position actions use `positionState`: a pinned view function taking the
Credit Account and `position_id`, with `marketIndex`, `directionIndex`, and
`directions: { long, short }` describing its results. `marketPath` becomes
`_state.market_id`; `price.directionPath` becomes `_state.direction`; arguments
use `{ source: "state", path: "market_id" }` or `direction`. Reads use finalized
state, and execution is still constrained by the approved onchain validator.
The getter's code, account ownership checks, direction mapping, and dependencies
must pass source review and the integration suite.

Internal fixed arguments use `{ source: "constant", value: "5" }`. Fixed costs
use `fundingAmount`, `spendAmount`, or `nativeValue`; each excludes the corresponding
path or bound source. Costs appear in the execution review and remain subject to
onchain spending policies. Arrays can map individual slots such as
`amounts_in.0.amount_in`, or use a reviewed validator for the whole ABI array.
Tuple component names in that mapping match the standard object fields; ABI
selectors and encoded types still match the application's deployed function.
Unsupported slots and optional fields cannot be silently ignored.

Existing manifests with arbitrary parameter names must be replaced and pass
admission before resolving through the SDK. Monad testnet's PriceProtection
supports stricter signed limit prices and guarded proxy oracles at its existing
proxy address.
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
reset after each call. Execution v2 signs each call's `nativeValue`; native MON
comes from the account and needs a separate, immutable registry value policy.
Mappings use `fundingPath` for House settlement cash, `spendPath` for token spending,
and `valuePath` for MON. Selling an owned token does not request a USDC draw.
Atomic spot trades use `price.kind: "min_output"` or `"max_input"` with an
`amountPath`. Governance binds the assets, decimals, oracle direction, and calldata
words through `configureExecutionAmountPrice`. Core verifies both the signed bound
and the account's actual input/output balance changes. Asynchronous orders retain
their reviewed execution-price rules and authoritative fill accounting.
Exact-output mappings can use `fundingFromBound`, `spendFromBound`, or
`valueFromBound` to use the derived maximum as their budget.
Apply the required Core, factory and execution-helper deployments or governed
upgrades before activating new bundles. Credit Accounts have immutable code;
new recovery funding requires accounts created by the updated factory. Existing
adapters without that interface keep their original execution path.
`ExecutionManager` reserves portfolio and pending slots,
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
Integrations configure the shared use-case reader, policy and recovery rules,
or the shared atomic spot module for immediate trades. The shared reader implements
`IAppStateReader` to enumerate at most
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
Monad execution. `source-wormhole` and `ethereum-wormhole-verifier` use paired
networks: Monad mainnet (`143`) with Ethereum mainnet (`1`), or Monad testnet
(`10143`) with Sepolia (`11155111`). Their Wormhole chain IDs are `48`/`2`
and `10009`/`10002`, respectively. Native Beacon stages require mainnet.
Every stage checks the connected chain before broadcasting.

Core's execution, reservation, and price helpers deploy in separate transactions
and bind to the predicted Core address. Direct deployments validate those bindings
at construction; proxies validate them during atomic initialization. Keep the
deployer nonce sequence intact between these stages.
The Monad wrapper uses a 100 percent gas estimate multiplier to avoid exceeding
the transaction cap with Foundry's default margin.

For Solana devnet, build a separate binary with:

```sh
cargo build-sbf --manifest-path contracts/solana/Cargo.toml --offline \
  --features testnet --sbf-out-dir contracts/solana/target/testnet/deploy
```

The default build retains mainnet Wormhole identities. The devnet build pins the
Solana devnet Core and accepts Monad testnet VAAs. The `testnet` feature requires
immutable deployment. Use `--features testnet-upgrades` for a devnet program
with retained upgrade authority, and explicitly configure that authority as
described below. `scripts/deploy-testnet.mjs --simulate`
uses local Monad testnet and Sepolia forks on ports `18545` and `18546`.
`--broadcast` uses the dedicated wallet in `.testnet/evm.json` and preserves a
resumable transaction journal in `.data/operations/deployment-upgradeable.json`. New deployments execute
their initial governance configuration immediately with a zero-second delay.
They do not admit collateral policies or deposit LP funds. The local keys, environment and unfinished journals are ignored by Git.
Completed journals are removed after the deployment configuration is saved.
Signed transactions are journaled before broadcast. Resuming a pending
transaction can raise an outdated fee by at least 25 percent, preserving its
nonce, call and gas limit; at most three replacements are permitted.
`node scripts/deploy-testnet.mjs --broadcast --activate` resumes queued
configuration on an existing deployment. It checks each onchain action and skips
actions that are still timelocked or already executed.

`ProtocolGovernance` takes an explicit delay at construction. Monad testnet and
Sepolia allow zero delay; other chains require at least two days.
The protocol deployment script reads `GOVERNANCE_TIMELOCK` in seconds and defaults
to zero on those testnets and two days elsewhere. Existing deployed delays cannot
be changed.

### Testnet upgrades

`deploy-testnet.mjs` deploys Core, execution/reservation/price helpers, Guardian, RiskEngine,
HouseVault, registries, account/inbox factories, health sources, native collateral,
and the Wormhole source/verification modules behind OpenZeppelin transparent
proxies. Initialization is atomic, implementation initializers are disabled,
and `UpgradeController` checks each implementation's contract identity.
Credit Accounts, SettlementInboxes, recovery reserves, and individual source
collateral vaults retain fixed custody code. App readers and recovery plugins
retain their existing version admission rules.

Each chain's controller owns the proxy administrators and is handed to
`ProtocolGovernance` during activation. The testnet deployer remains the initial
governance owner with zero delay. `transferGovernance(next)` nominates a wallet or
multisig; that address must call `acceptGovernance()`. Passing the zero address
cancels a pending nomination. The controller also supports two-step ownership
transfer. These transfers preserve public contract addresses.

These proxies permit administrator replacement of live testnet logic. They are
restricted to Monad testnet and Sepolia; production uses the version and custody
protections in `termbook.md`. A multisig or storage check does not remove the
administrator trust of a mutable implementation. Existing immutable testnet
addresses require an initial replacement deployment.

Build contracts, then prepare and execute a compatible update:

```sh
FOUNDRY_VIA_IR=true forge build --root contracts/evm
node scripts/upgrade-testnet.mjs 10143 PriceProtection PriceProtectionV2 --prepare
node scripts/upgrade-testnet.mjs 10143 PriceProtection PriceProtectionV2 --broadcast
```

The candidate artifact must preserve existing storage and function interfaces,
avoid reserved proxy selectors, and retain its contract identity. Preparation
stores a reviewable plan under `.data/operations/`. Execution validates the live
baseline and reviewed bytecode hash, journals signed transactions before
broadcasting, and updates `deployments/testnet.json` after confirming the new
implementation. Initialization calldata may be supplied as the final argument.
`TERMBOOK_UPGRADE_RPC_URL` optionally selects another RPC for the requested chain.
After governance ownership moves to a multisig, approve the prepared queue
transaction through that multisig, then resume `--broadcast`.

Credit inventories are read from finalized Core events. A configured Envio archive
supplies receipt-verified events. `TERMBOOK_CREDIT_RPC_URL` explicitly selects a
Monad testnet RPC with a larger log range for
shared integration checks. Its chain and finalized block must match the primary
RPC. The public endpoint's small log range can make a full scan slow.

For an upgradeable Solana devnet deployment, build with `testnet-upgrades`, deploy
with a retained native loader authority, and set `SOLANA_PROGRAM_ID` and
`SOLANA_TESTNET_UPGRADE_AUTHORITY` before the EVM deployment. The admitted devnet
catalog market supplies `testnetUpgradeAuthority` to the browser wallet automatically.
Custom wallet ports and the source keeper must specify the same expected authority.
Binary hashes remain checked; a changed binary requires
reviewed proof/version configuration before use. Mainnet and the ordinary
`testnet` binary require immutability.

```sh
cargo build-sbf --manifest-path contracts/solana/Cargo.toml --offline \
  --features testnet-upgrades --sbf-out-dir contracts/solana/target/testnet/deploy
solana program deploy contracts/solana/target/testnet/deploy/sol_collateral.so \
  --url devnet --program-id <new-program-keypair> --upgrade-authority <authority-keypair>
```

The active devnet program retains its recorded upgrade authority. Native loader
upgrades preserve its program ID. Existing EVM deployments use
`upgrade-testnet.mjs`; the deployment runner rejects overwriting an existing
deployment. The original replacement migration tooling has been removed.

The active testnet addresses, configuration and code hashes are recorded in
[`deployments/testnet.json`](deployments/testnet.json).

| Network | Contract | Address |
| --- | --- | --- |
| Monad testnet | TermbookCore | `0x198995faab55a9d5d4dceab56abaaa273c26fad7` |
| Monad testnet | USDC HouseVault | `0xdeace78c2cb205cec7bf2ceed7fef49ae659e011` |
| Monad testnet | MON collateral vault | `0x60137739e130157b18c69df63289d8b823c82854` |
| Sepolia | WETH collateral vault | `0x63C89cC35FF9f25cA6d97345b97942E2B1766A4a` |
| Solana devnet | SOL collateral program | `6DK2Q3wWSFSBHpUiauKuyVbTDTW8cvrzdVTjuPQy8bfz` |

The upgradeable testnet replacement was deployed on 8 October 2026 (Lagos time).
All 121 EVM transactions succeeded, 27 proxies were verified, and all 13 initial
governance actions executed. Both upgrade controllers are owned by their network's
governance contract; the deployer remains the testnet governance owner, with zero
waiting period. The Solana devnet program retains its recorded upgrade authority.
House registration, Wormhole configuration, verifier admissions, ETH custody
bindings and SOL program identity were checked onchain. The current record
includes implementation pins and storage layouts required to validate upgrades.

On 9 October 2026, `FlowExecutor` (the execution manager), `AccountFactory`,
`PriceProtection` and `TermbookCore` were upgraded at their existing proxy
addresses. The seven shared integration components listed above received their
first deployments. All 19 transactions succeeded, costing 5.80317015 MON.
Independent finalized verification checked all 19 receipts and 23 Monad proxies.
The checks preserved all six credit records, existing account addresses, LP
shares, House balances and prior storage slots. The factory upgrade applies
the new recovery-call implementation to newly created Credit Accounts; existing
accounts keep their custody code. Sepolia and Solana code did not change.
Current addresses and implementation pins are recorded in
`deployments/testnet.json`; SDK bindings and the local server
configuration include the shared component addresses.

```sh
node scripts/setup-testnet-integrations.mjs --simulate
node scripts/setup-testnet-integrations.mjs --broadcast
node scripts/verify-testnet-integrations.mjs
```

The simulation requires a current Monad testnet fork on port 18545. The live
runner checks storage and interface compatibility, a complete settled-credit
inventory, unchanged state and the simulated gas budget before signing.
It journals transactions atomically and upgrades the execution manager before
Core. The verification command uses no signing key and checks all Monad proxies,
compiled runtime code and current bindings at a finalized block.

The retired deployment's credit setups were verified as settled before migration.
Its House is disabled and paused, its Sepolia controller is paused, and its
10.007004 test USDC was withdrawn. The replacement House received 10 test USDC.
Completed migration logs and retired deployment snapshots are removed.

The ETH/USDC ratio feed, ETH collateral policy, House risk and reservation policies,
reference integration and keeper roles are active on the replacement. The Sepolia
controller is unpaused. The local API and keepers use the new Core and a separate
MongoDB database; `/ready` verifies the finalized index and risk scans. Its setup
records use the new Core address. On 8 October 2026 the replacement completed
two live WETH-backed 1 USDC loans through the reference app: normal repayment
and keeper-forced exit and repayment. Both have zero debt, returned collateral,
empty app positions and released account control. All 38 listed receipts were
verified as canonical and finalized.
The run took 54m 15s including the deliberate default wait and Ethereum finality.
Canonical acceptance-to-closure times with full Sepolia finality were 34m 23s and 53m 20s. Draw-to-repayment
took 5s; the keeper detected default 18s after grace and recovered the loan in
another 20s. The House manager and sole LP are the testnet deployer.
These exercises did not use Aurora conversion or a real trading venue.
Native SOL price admission and the separate Solana source keeper are active.
The SOL/USDC feed reads Pyth SOL/USD and the admitted USDC/USD feed, rejecting
stale prices and excessive confidence intervals. Two live devnet SOL-backed loans
completed borrowing, reference app exit, repayment, keeper return and final closure.
The clean run locked 0.005 SOL and borrowed 1 test USDC. Independent checks confirmed
13 canonical Monad receipts and four finalized Solana receipts, including the
return signed by the separate keeper. Both credits have zero debt, zero remaining
collateral, empty app positions and released account control.

| Clean SOL run | Canonical elapsed time |
| --- | --- |
| Acceptance to borrowing | 2m 7s |
| Lock to accepted collateral proof | 1m 8s |
| Accepted proof to borrowing | 32s |
| Borrowing to repayment | 6s |
| Return authorization to source return | 1m 28s |
| Source return to Monad confirmation | 1m 13s |
| Acceptance to final closure | 5m 6s |

These measurements include runner startup, public RPC retries, keeper polling
and Wormhole observation; they are not individual Monad transaction latency.
The first run includes debugging waits. Current price and keeper setup is in
`deployments/testnet.json`. SOL default seizure and Aurora
conversion were not exercised by these repayment tests.

Sepolia now uses an explicitly admitted five-block Wormhole confirmation policy
for testnet loans. Its governed publisher configuration, signed policy hash and
version 2 verifier are configured in `deployments/testnet.json`.
The SDK catalog, proof publisher and return worker apply the same admitted depth.
The ordinary Ethereum route retains full finality. Five-block confirmation accepts
reorganization risk before Ethereum finality and is restricted to Sepolia and
Monad testnet. The test runners poll every two seconds.

Two WETH-backed repayment loans completed using this policy. Independent checks
confirmed that their lock and return VAAs carry consistency 203 and the admitted
five-block policy hash. The continuous run borrowed 2m 36s after acceptance:
50s for source setup, 1m 38s for the collateral proof, and 8s from accepted proof
to borrowing. It repaid in 7s, returned WETH 37s after authorization, and confirmed
the return on Monad another 2m 42s later. Final closure took 8m, including a
1m 52s runner restart delay after return confirmation. The first run includes
debugging and launch waits. These are testnet reference app measurements.
All 18 listed receipts in each run were independently checked as canonical and
fully finalized after the faster borrowing and return flow completed.

```sh
node scripts/testnet-solana-e2e.mjs --begin --clean
node scripts/testnet-solana-e2e.mjs --run --clean
node scripts/verify-testnet-solana-e2e.mjs --clean
node scripts/testnet-e2e.mjs --start --fast --clean
node scripts/verify-testnet-e2e.mjs --fast --clean
```

Runners resume unfinished journals under `.data/operations/`. Verification checks
canonical receipts and eventual full source finality, then removes completed run
files. Starting again after successful verification creates a new live test.

Native MON collateral is admitted on Monad testnet using Pyth MON/USD and the
registered USDC/USD feed. The live MON/USDC ratio rejects stale prices and excessive
confidence intervals. The admitted vault code, guardian, collateral risk policy and
oracle-backed USDC bid floor are recorded in `deployments/testnet.json`.

```sh
node scripts/setup-testnet.mjs --simulate --native
node scripts/setup-testnet.mjs --broadcast --native
node scripts/testnet-e2e.mjs --start --native
node scripts/verify-testnet-e2e.mjs --native
```

On 10 October 2026, two native MON-backed loans each locked 2 MON and borrowed
0.10 test USDC through the reference app. Repayment and independent keeper recovery
both completed with zero debt, returned native collateral, empty app positions and
released account control. All 25 borrower and recovery receipts were independently
checked as canonical and finalized. The repayment case borrowed 36 seconds after
acceptance and closed after 51 seconds. The default case included a deliberate
seven-minute maturity wait and a keeper gas top-up; it closed after 9m 39s.
This test did not sell MON collateral or exercise a real trading venue.

Envio has replayed the finalized Core event history into Docker MongoDB, and the
local API and keeper readiness check passes. Aurora settlement routes remain
unconfigured and their live tests are deferred.
Aurora settlement exercises require a Studio application key and confirmed
sandbox asset pairs for these testnets. Testnet governance has no waiting period.

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
| MON | Native MON enters `NativeCollateralVault` on Monad and is held as WMON. | Vault, feeds, USDC sale policy and collateral admission are active. Live borrowing, repayment, independent app recovery, WMON collateral sale and native returns passed. |
| ETH | WETH stays in `CollateralVault` on Ethereum. | The Wormhole route verifies custody snapshots and return authorizations onchain. The admitted replacement passed live reference-app borrowing, repayment, recovery and returns. The separate native consensus route remains available. WETH seizure and Aurora conversion still need a live exercise. |
| SOL | Native SOL stays in a Solana program-derived account. | Posted Wormhole VAAs authorize source custody actions; Monad verifies signed snapshot VAAs. The devnet program, price feeds and separate source keeper are active. Live reference-app borrowing, repayment and collateral return passed. Default seizure and Aurora conversion still need a live exercise. |

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
executing program and ProgramData accounts. Mainnet and ordinary testnet builds
reject an active upgrade authority; `testnet-upgrades` permits a nonzero devnet
authority with explicit SDK and keeper opt-in. The shim accounts are payer, bridge, message, emitter, sequence, fee
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

The settlement adapter uses the Aurora Intents Swap API to quote an admitted ERC-20
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

Create the application key in [Aurora Intents Studio](https://studio.aurora.dev/)
and store it as `AURORA_API_KEY` in the server environment. The default origin is
`https://intents-api.aurora.dev`; quotes use `/api/quote/{key}` and status uses
`/api/status/{key}`. The key is encoded as one path segment. Aurora's responses
carry the underlying 1Click service's signed quote, verified with its SDK key.
See [Aurora's API key guide](https://docs.intents.aurora.dev/getting-started/api-keys-and-fees)
and [Swap API reference](https://docs.intents.aurora.dev/api-reference/swap-api-reference).
Monad testnet may configure a provider's
HTTPS sandbox origin through `AURORA_API_URL` and its verified Ed25519 quote key
through `AURORA_QUOTE_PUBLIC_KEY`. Both are rejected outside chain 10143. Quote,
status and recovery funding use the same pinned key; redirects are rejected.
Sandbox token identifiers and usable routes must come from the provider.

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
