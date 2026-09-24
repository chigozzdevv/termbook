# Termbook

Termbook provides credit inside applications on Monad. Borrowers lock collateral
on a supported chain and draw funds from a House through a restricted Credit
Account. The account holds the borrowed funds and the assets they create.

Source collateral may be worth less than the debt. The remaining protection
comes from assets that Termbook can value and recover from the Credit Account.
This is source-undercollateralized, position-secured credit.

This specification defines required behavior. Contracts, SDK methods, and
application support require implementation and validation before use.

## Participants and terms

| Term                    | Meaning                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Borrower                | Accepts a facility and authorizes application actions.                                                                                |
| House                   | Sets credit terms and manages one isolated lending market.                                                                            |
| HouseVault              | Holds one House's settlement asset, funds draws, and receives repayments.                                                             |
| Liquidity provider (LP) | Deposits into a HouseVault and receives shares in that House.                                                                         |
| Credit                  | An accepted facility, including its limit, debt, collateral, and policy.                                                              |
| Intent                  | A request for a facility, with optional application-action context.                                                                   |
| Quote                   | A signed House offer that fixes the facility terms.                                                                                   |
| Credit Account          | Executes approved actions and controls the assets securing one Credit.                                                                |
| Application             | A protocol integrated with Termbook.                                                                                                  |
| IntegrationVersion      | A reviewed, immutable manifest for an application deployment and its execution, valuation, and recovery rules.                        |
| Integration bundle      | A primary IntegrationVersion and its approved dependencies, such as an asset conversion route.                                        |
| Capability              | A typed operation, such as placing an order or redeeming vault shares.                                                                |
| Action                  | One authorized use of a capability.                                                                                                   |
| Flow                    | A tracked operation that may span several transactions.                                                                               |
| Keeper                  | Relays proofs or submits eligible settlement and recovery transactions.                                                               |
| Aurora Intents adapter  | Quotes, converts, and delivers approved cross-chain value transfers. It does not prove collateral custody or authorize vault actions. |
| SettlementInbox         | An isolated Monad escrow for one value-routing operation, with fixed settlement and refund rules.                                     |

Token amounts use integer base units. Ratios use basis points where specified.
Chain identifiers are numeric chain IDs; timestamps are Unix seconds and durations
are seconds. Deployment manifests define asset decimals and valuation precision.

## Core rules

1. House funds enter a restricted Credit Account. They cannot be drawn into an
   unrestricted borrower wallet.
2. Each account binds one borrower, Credit, HouseVault, integration bundle, and
   accepted policy. Houses do not share a financed position or its losses.
3. The borrower chooses actions. The account executes them and owns the resulting
   assets or holds an enforceable senior recovery claim.
4. Registered flows control targets, selectors, approvals, recipients, and value
   transfers. Borrower input cannot replace them.
5. Health uses verified collateral, current onchain application state, approved
   prices, and net recovery value. Frontends and indexers cannot authorize credit.
6. Every draw and risk increase must pass policy and post-action health checks.
7. Repayment and safe exits remain permitted during a Termbook pause. Their
   execution still depends on valid state and available application paths.
8. Recovery repays the originating HouseVault. Borrower surplus follows the
   accepted terms.
9. Policy or integration updates do not silently rewrite a live Credit.

## Facility lifecycle

```text
Request offers
-> accept and reserve
-> lock and prove source collateral
-> create Credit Account
-> facility ready
-> draw and execute approved actions
-> repay and close, or recover through liquidation
```

LP capital stays in the HouseVault until a draw. Source collateral stays in its
CollateralVault until an authorized release or recovery.

### 1. Request offers

The borrower selects a collateral chain, asset, amount, and duration. They may
request an explicit facility limit or supply a typed application action to fund.
Termbook first checks whether an existing Credit can cover that action. Otherwise,
it requests compatible House offers. Without an action, a limit is required.

For a prepared action without an explicit limit, each House quotes the capacity
needed for the action and its financed costs. The registered integration supplies
funding requirements, units, and approved conversion bounds. Each offer shows
usable action funding, financed fees, costs payable separately, and the resulting
facility limit. Draw-dependent fees are included in the same funding calculation.
The borrower reviews the complete limit before acceptance; it is not an instruction
to draw that amount. An explicitly requested limit is a cap and cannot be increased
without a revised request and fresh offer review.

Each Intent presents up to five current offers, with one offer per House.
Discovery may query all eligible Houses. Rank compatible offers by estimated
total cost for the same usable action funding and duration, with the cost
assumptions and risk terms visible. Requests without an action use the same
disclosed draw and utilization assumptions across offers. Show fewer offers when
fewer qualify. No offer reserves funds until accepted.

An open Intent has a short discovery expiry independent of the requested loan
duration. Registered Houses poll an authenticated, asset-filtered feed and
submit signed Quotes before that expiry. Offer discovery rechecks the House,
vault asset, Quote expiry, and application binding against finalized state.

A Quote binds:

- borrower, collateral owner, Intent, House, and HouseVault;
- source chain, CollateralVault, collateral asset, amount, and return recipient;
- settlement asset, facility limit, integration bundle, and allowed capabilities;
- market, asset, leverage, notional, deposit, concentration, and portfolio-size limits;
- interest calculation, fees, repayment allocation, and revolving treatment;
- acceptance expiry, setup deadline, reservation bond, maturity, grace period,
  and abort terms;
- valuation rules, recovery thresholds, withdrawal rules, and recovery costs;
- servicing Core and custody versions, verification paths, and migration rules;
- nonce, signing-key epoch, policy version, and terms hash.

The borrower compares complete costs and risk terms before accepting an offer.
Recheck the selected offer before acceptance. Expired or changed terms require
fresh review. Accepting one offer consumes the Intent's acceptance authorization;
the remaining offers cannot create another Credit from that Intent. Changed
action inputs require a fresh execution review and authorization.

### 2. Accept and reserve

Core verifies House and borrower authorizations, Quote validity, limits, and
House liquidity. Acceptance atomically funds the reservation bond, reserves the
committed limit, and creates the Credit. It does not draw House funds or start
interest on principal.

The borrower or an authorized sponsor supplies the bond in the settlement asset.
The bond covers disclosed reservation charges and setup costs; it cannot be
financed by an unsecured House draw. Minimum bond and reservation charges scale
with the reserved amount and maximum setup duration under protocol-enforced
floors. Sponsor funding has explicit authorization and spending caps.

The SDK's `intent.accept()` guides the complete setup: bond funding and acceptance,
collateral locking, proof verification, and account preparation. It returns the
Credit when the facility is `ready`. Each required wallet approval remains
explicit. These steps can span transactions and chains; confirmed steps remain
recorded if setup is interrupted.

The setup reservation expires at the signed setup deadline. House policy also
limits outstanding reservations per borrower and in total. The Quote fixes bond
charges, refunds, recipients, and settlement for readiness, borrower abandonment,
expiry, and verifiable protocol failure. Repeated abandoned reservations incur
the disclosed charge. Bond accounting remains separate from LP assets and debt.

At readiness, Core settles the setup bond and converts the reservation into the
accepted facility commitment without releasing its liquidity. The setup deadline
no longer expires that commitment. Undrawn commitments follow the facility's
maturity, closure, recovery, and commitment-fee rules.

### 3. Lock and prove collateral

The collateral owner locks assets in the source CollateralVault. Each deposit has
a unique `lock_id` and binds the Credit, borrower, owner, asset, amount, source
chain, servicing Monad Core, nonce, and authorized return recipient. Initial locks
also bind the setup deadline; the source vault rejects execution after that
deadline. A lock executed before the deadline may still be proved after it.

If the collateral owner and Monad borrower differ, each wallet authorizes its
role. The source owner authorizes the lock and return recipient. The borrower
accepts the debt and collateral binding. An app token cannot provide either
authorization.

For remote collateral, a keeper relays the configured finalized header and lock
proof to Monad. Core verifies custody, binding, proof age, and valuation before
counting the collateral. Source top-ups follow the same proof requirements.

### 4. Create the account

Core creates a clean Credit Account and binds the accepted policy and recovery
destination. It checks ownership, modules, approvals, callbacks, and execution
permissions. Application setup must use the account's actual execution identity.

The facility becomes `ready` after collateral and account binding, settlement of
the setup bond, and conversion to the facility commitment. These checks must
complete before the setup deadline. Principal is still zero. The facility stays
`ready` during ordinary use, including repeated draws and repayments. Maturity
changes payment state and disables further draws.

### 5. Review, draw, and execute

`credit.app.execute(action)` validates the registered capability, reads current
state, and shows the draw, fees, projected debt, exposure, and simulated
post-action recovery health against the initial threshold for approval.
The SDK prepares this review internally. The caller supplies the typed action.

```text
required_draw = max(0, required_input - compatible_free_account_assets)
```

Required input includes the action's funding needs and accepted costs, expressed
in settlement-asset units. Reserved assets and pending claims are not free assets.
Conversion requirements come from the approved bundle. The SDK calculates and
includes the draw bound in the borrower's authorization.
The draw cannot exceed that signed bound, available credit, or policy limits.

For example, 700 USDC of margin and 200 USDC of compatible free account funds
require a 500 USDC draw before any additional accepted costs. The facility limit
and position notional are separate from this draw.

With no free account funds, 700 USDC of margin and 5 USDC of financed costs require
705 USDC of capacity. A 700 USDC limit cannot fund that action. Changes in costs
or conversion requirements that exceed the accepted limit require new terms or
an explicitly revised action; execution cannot silently increase the limit.

The borrower authorizes the action. Core checks its nonce, deadline, policy, and
state revision. HouseVault sends the required funds to the Credit Account, which
executes the registered calls. Debt begins when funds leave HouseVault.

A synchronous failure reverts the full Monad transaction, including the draw.
Remote locking and proof submission are separate transactions. Price-sensitive
actions receive a fresh review after the facility becomes ready.

#### Execution price protection

Perps actions use `slippage_bps`; 50 basis points means 0.5%. At authorization,
Termbook reads a valid reference price and derives the direction-specific maximum
or minimum execution price. It binds that limit, the parameters, draw, and expiry
to the signed action. Execution cannot move the reference price to widen the
borrower's tolerance. Stale or changed terms require fresh authorization.

The integration defines price units, rounding, and allowed order types. Additional
order types must define their own typed price and trigger rules. Capability schemas
validate slippage against the accepted House policy.

### 6. Manage the facility

The borrower may repeat approved actions without a new House approval. Each
action requires borrower authorization or a valid bounded session key.

For a revolving facility, repaid principal restores contractual draw capacity.
For a non-revolving facility, capacity equals the limit minus cumulative draws.
Interest and fee payments do not restore principal capacity. Actual available
credit is also bounded by reserved House liquidity, health, and policy.

Increasing the limit or changing scope requires primary-wallet approval and new
House terms when House risk increases.

### 7. Abort unused setup

Setup may abort before any draw or application liability exists. Core cancels
authorizations, releases the reservation, settles the bond and disclosed setup
charges, and authorizes collateral returns. The Credit becomes `aborted` and can
never become ready or draw funds. Its collateral return remains separately tracked.

Core continues accepting finalized lock evidence for an aborted Credit, including
locks never bound before abort and proofs arriving after the setup deadline.
Each verified `lock_id` produces a return authorization for its remaining locked
amount and original authorized recipient. This path requires neither a ready
account nor a restored reservation. Source consumption and return proofs prevent
the same deposit from being bound, refunded, or recovered twice.

Anyone may relay the required lock and return proofs. A delayed source transaction
that executes after the setup deadline is rejected by the source vault. A lock
executed before the deadline but finalized or discovered later follows the same
abort-return path. Local expiry alone never authorizes a source-vault withdrawal.

After a draw or application liability, the Credit must use repayment, closure,
or recovery. Cross-chain returns remain tracked until confirmed.

## Execution and authorization

```text
Borrower authorization
-> Core: Credit state, funding, policy, and signature checks
-> AppGateway: typed parameters and registered application calls
-> Credit Account: target, selector, approval, value, and recipient checks
-> application contracts
-> Risk Engine: verified state, liabilities, and recovery health
```

The application sees the Credit Account as the caller when ownership is
caller-based. Explicit subaccounts, NFTs, and position identifiers must be bound
to that account through registered state. Shared gateways cannot hold borrower
funds or own unrelated borrower positions.

Accounts have no borrower-callable generic execution path. They cannot bridge
protected assets, install uncontrolled modules, change recovery authority, or
delegate execution to application-controlled code. Approvals are exact or
policy-bounded and reduced after use where supported. Callback and reentrancy
rules apply to the complete execution context.

### Signatures and sessions

Typed signatures bind chain, Core, Credit, integration bundle, capability,
parameters, policy hash, maximum draw, state revision, nonce, and deadline.
Parameters include price bounds, minimum output, and recipient rules. Each
authorization is single-use within its nonce domain.

Core advances the Credit revision after changes to debt, collateral accounting,
policy, pending actions, or controlled positions recorded by Termbook. External
market changes still require fresh runtime reads. Revision checks do not replace
price, permission, or health checks.

A session key is limited to one Credit and integration bundle. Its scope fixes
capabilities, markets, per-action and aggregate limits, expiry, and revocation.
Only the primary wallet may broaden permissions. Revocation takes effect onchain.

Borrowers or registered relayers submit authorized actions. Gas sponsorship and
reimbursements follow signed limits. Keepers earn proof fees only for successful,
valid submissions. Liquidation uses separate authority and needs no borrower
signature.

### Asynchronous actions

Submission records the application's pending identifier, committed funds,
worst-case exposure, deadline, and refund destination. Debt accrues while House
funds remain outstanding. Pending funds cannot be withdrawn or counted twice.

Each integration defines partial fills, cancellation, failure, expiry, and
settlement. Cancellation requests remain pending until authoritative state
confirms their result. A fill racing with cancellation is reconciled from that
state. Filled exposure and the unfilled remainder are tracked separately.

Eligible callers may finalize through registered rules. Finalization is
idempotent and verifies the pending identifier and accounted amounts. Refunds
return to the Credit Account. Debt falls only when repayment reaches HouseVault.

If an external fill has already settled, a failed health check cannot undo it.
Core records the resulting exposure, blocks new risk, and applies recovery rules
when eligible. Failed or overdue actions retain their liabilities until verified
settlement or recovery resolves them.

## Health and valuation

All values use the same settlement-asset denomination and a consistent valuation
snapshot. Each asset or claim is counted once.

```text
d = principal + accrued interest + due fees
c = recoverable free settlement cash in the Credit Account
s = current value of finalized source collateral, excluding pending releases
a = net application proceeds after senior liabilities and application exit costs
r_s, r_a = retained-value factors after the applicable haircuts
k = remaining recovery costs not already deducted from c, s, or a

application_value = r_a * max(a, 0) + min(a, 0)
recovery_value = c + r_s * s + application_value
recovery_health = recovery_value / (d + k)
```

A 20% haircut gives a retained-value factor of `0.8`. These factors range from
zero to one. Negative application equity is deducted in full. Valuation rules
identify each cost and deduction so it is applied once.

Application value reflects simultaneous portfolio unwind, funding obligations,
slippage, liquidity, depeg risk, oracle uncertainty, delay, and correlated losses.
Position notional and unclaimable rewards do not count as recovery value.

For example, assume `c = 100`, `s = 400`, `a = 600`, `r_s = 0.8`, `r_a = 0.9`,
`d = 700`, and `k = 20`. Recovery value is `960`; recovery health is about `1.33`.
These numbers illustrate the calculation, not a House risk policy.

When debt is zero, the UI shows health as not applicable. Pending obligations,
commitments, and safe-release checks still apply.

### Thresholds and permissions

Quotes define ordered thresholds:

```text
initial >= maintenance > watch >= freeze >= liquidation >= protocol_floor > 1
```

At health `1`, stressed recovery value only equals debt plus recovery costs.
Core enforces the approved `protocol_floor` for the collateral market and
integration bundle. Its buffer covers residual execution and delay risk beyond
the losses already included in valuation, without counting those deductions twice.
House thresholds may be stricter, but cannot fall below this floor. First-loss
capital and reserves do not permit a lower liquidation threshold.

The initial threshold applies to draws and risk increases. Maintenance applies
to ordinary withdrawals and successful recovery back to ordinary use. At or below
a risk threshold, the most restrictive matching state applies. Default and
emergency rules may also restrict actions.

| Risk state   | Effect                                                                         |
| ------------ | ------------------------------------------------------------------------------ |
| Healthy      | Actions remain subject to their applicable threshold and policy.               |
| Watch        | Warn the borrower. Undrawn availability changes only as accepted terms permit. |
| Frozen       | Block draws and risk increases. Permit repayment and verified safe exits.      |
| Liquidatable | Permit registered recovery after Core verifies eligibility.                    |

Application liquidation rules protect that application. House policy must allow
earlier recovery when application liquidation could consume House backing.
Risk-reducing actions use separate loss and price bounds when normal thresholds
cannot be restored immediately.

Monitors track prices, debt, application state, pending actions, permissions,
upgrades, and unwind liquidity. Contracts verify consequential transitions.

### Portfolio and execution bounds

Each integration bundle sets hard limits for open positions, pending actions,
assets, withdrawal claims, dependency depth, and calls per execution step. Houses
may impose lower limits. Core reserves the required slots before submission,
including the maximum positions or claims an asynchronous action can create.
Cancellation releases slots only after authoritative settlement is reconciled.

Health checks must fit the supported chain's execution budget at the maximum
permitted portfolio size. Unsolicited assets do not expand tracked collections
or receive positive recovery value. Every authorized liability-bearing path must
fit the tracked limits. Integrations cannot require unbounded scans of balances,
historical events, or application records.

Recovery processes a bounded set of registered steps with durable progress and
idempotent settlement. Each step verifies custody, recipients, liabilities, and
its accepted loss bounds. New risk and borrower withdrawals remain blocked
between steps. No final valuation or settlement step may require an unbounded
loop. Deployment validation covers the maximum supported portfolio and pending
state, including interrupted recovery and asynchronous fills at the limits.

## Repayment, withdrawal, and closure

### Trading proceeds

Closing a position returns its released margin and net proceeds to the Credit
Account. The registered close flow includes any application settlement or
withdrawal transactions. It completes only when receipt is verified. Shared
margin needed by other positions remains protected.

Cancelled orders return refundable funds to the same account. Partial reductions
and margin removals return only the amount safely released by the application.
These movements do not repay the House or transfer funds to the borrower wallet.

When free settlement cash and debt coexist, the interface shows continuing
interest and offers **Repay debt** or **Keep funds for another trade**, subject
to the accepted repayment rules. Repayment uses a separate authorization unless
the borrower has enabled a bounded automatic repayment instruction. That
instruction specifies its eligible proceeds, cap, expiry, and revocation, and
cannot consume funds reserved for application obligations. It follows the same
HouseVault receipt and debt-accounting rules as ordinary repayment.

Before enabling automatic repayment or confirming a repayment, show the effect
on remaining draw capacity. Repaid principal restores revolving capacity while
the commitment remains available; non-revolving capacity is not restored.

### Repayment

Repayment may come from account settlement funds, a Monad wallet, or the registered
Aurora Intents route from another supported chain. Core credits payment only after
the bound HouseVault receives the required asset. The accepted allocation rule
divides payment among principal, interest, and fees. Excess payment has a defined
return recipient.

For a remote payment, arrival at its SettlementInbox and application to HouseVault
are separate steps. Settlement transfers the accepted amount to HouseVault and
updates debt in one Monad transaction. Interest accrues on outstanding principal
until that transaction succeeds. A partial payment reduces only the claims it
actually pays; an unfilled target remains visible. `amount: "max"` uses a reviewed
payment cap and delay allowance, then recalculates debt at settlement. Additional
funding needs fresh authorization; excess funds follow the bound refund rules.

If account proceeds cannot cover the debt, the modal shows the shortfall and
requests an approved repayment source. It cannot complete voluntary closure with
unpaid House claims. A Credit eligible for liquidation follows the recovery rules.

### Withdrawals

`max_withdrawable` is an asset amount. It is bounded by transferable account
assets and a simulated post-withdrawal health check. The simulation includes
liabilities, costs, pending exposure, and the maintenance buffer. Account
withdrawals go to the Credit's fixed borrower recipient. Terms may require
profits to repay debt first.

`credit.account.withdraw({ asset, amount })` transfers permitted account surplus
to the borrower's registered wallet on Monad. It keeps the facility open. Pending
proceeds and unrealized gains are not withdrawable cash. A failed health or policy
check rejects the withdrawal.

A source-collateral withdrawal is reserved on Monad before its release message
is issued. The reserved amount immediately stops contributing to health and
draw capacity. Concurrent releases use the remaining unreserved amount.

The source vault consumes each authorization once. Core tracks confirmation or
expiry. Expiry alone does not restore collateral value: a finalized source proof
must establish that the release was not consumed and can no longer execute.
Liquidation excludes pending releases from available collateral and reconciles
them through the same proof path.

### Closure

Full repayment does not automatically terminate a revolving facility.
`credit.close()` obtains the required exit authorizations and coordinates the
complete exit. The normal unwind path:

1. enters `closing`, blocks every draw and risk increase including use of existing
   account cash, revokes trading sessions, and releases undrawn House commitments;
2. cancels pending orders and reconciles fills, refunds, and remaining exposure;
3. unwinds positions through the authorized paths, collects their proceeds, and
   settles application liabilities and exit costs;
4. repays principal, interest, and due fees from free settlement cash, requesting
   an approved additional source only for a remaining shortfall;
5. removes remaining approvals and permissions no longer needed for settlement;
6. sends transferable surplus to the borrower's registered Monad wallet;
7. releases account control and returns source collateral through the approved
   paths to their registered recipients;
8. confirms all required transfers and marks the facility `closed`.

Available free cash may repay debt while other exits are pending. Repayment never
requires a position to remain open when its authorized unwind supplies the funds.
Pending callbacks and settlement calls retain only their registered permissions.
The primary wallet may authorize the remaining safe exit steps; revoked trading
sessions cannot resume risk during closure.

The alternative **Repay and keep position** path is available only when the
integration supports validated debt-free ownership release. It applies the same
initial freeze and pending-action reconciliation, obtains repayment from an
approved source without selling the retained position, and verifies that all
House claims are settled before releasing control. Remaining application
obligations must stay with that position and cannot retain a claim on House assets.
The Quote discloses whether this path is supported. Closure obtains authorization
for the selected unwind or retention path and any migration; it never silently
sells a retained position. A blocked or underfunded closure stays frozen and may
enter liquidation only under the accepted recovery eligibility rules.

The Credit stays `closing` while any required settlement, source-chain finality,
or return proof is pending. `close()` resolves only after the return is confirmed
through the configured verification path. It completes the collateral return
internally. Reopening the modal resumes the same closure without duplicate transfers.
Repaid principal stops accruing interest even if collateral return takes longer.

For example, 800 USDC of settled account proceeds and 705 USDC of total debt leave
95 USDC for the borrower after repayment, assuming no further exit costs. The
original source collateral returns separately on its own chain. House principal
is not part of the borrower payout.

## Maturity and liquidation

At maturity, undrawn commitments end, new risk stops, and outstanding debt becomes
due. Pending actions follow their accepted settlement rules. Unpaid debt becomes
defaulted and liquidatable after the grace period. Renewal requires a new offer
and borrower acceptance.

Liquidation may also start at or below the liquidation threshold or under an
accepted emergency condition. A frontend outage is not an eligibility signal.

Anyone may submit a registered recovery plan. Core verifies eligibility,
recipients, price bounds, costs, and application liabilities. Partial recovery
must improve stressed recovery health and repay debt or secure proceeds for
repayment. Otherwise, use the registered full-recovery path. Delayed exits may
create a controlled withdrawal claim under defined cost and loss bounds.

```text
liquidating -> recovery_pending, if settlement is delayed
liquidating or recovery_pending -> ready, after a verified cure
liquidating or recovery_pending -> liquidated, after full recovery is finalized
```

A cure returns a partially recovered Credit to ordinary use only before maturity,
with no unresolved default, emergency restriction, or integrity failure. Core
verifies settled recovery operations, actual repayments received by HouseVault,
and all remaining positions, pending exposure, and liabilities. Recovery health
must reach at least maintenance using fresh verified state. If debt is zero,
the remaining-obligation and safe-release checks replace the health ratio.
Secured but unsettled recovery proceeds alone do not establish a cure.

Partial recovery suspends draw availability while retaining the undrawn
commitment until cure, maturity, or a transition to full termination. A cure
restores only the capacity still supported by that commitment and the accepted
revolving rules. Trading sessions revoked for recovery remain revoked until
authorized again. A Credit already closing, a matured Credit, or a full-recovery
plan committed to termination cannot return to `ready`.

Recovery blocks draws, new risk, borrower withdrawals, and ownership release,
and revokes trading sessions. Full termination releases undrawn commitments.
Keepers cancel orders, reduce or close positions, redeem claims, convert approved
assets, and send proceeds to HouseVault. Failed steps remain retryable without
double execution. Unavailable state or an unusable exit triggers a freeze and
loss assessment; it does not count as successful recovery. Debt and remaining
claims continue under the accepted terms.

The loss waterfall is:

1. controlled settlement cash;
2. net application recovery;
3. source-collateral proceeds;
4. funded borrower or sponsor first loss;
5. funded underwriter first loss;
6. House reserves;
7. originating House LPs.

Recovery can start on both chains as policy permits. The waterfall determines
allocation, not a requirement to wait through every remote delay. Protocol fees
are not senior to lender principal during insolvency. Surplus follows the Credit
terms. `liquidated` means full recovery has been finalized and the facility has
terminated, not necessarily that all debt was paid. A cured facility returns to
`ready` with its recovery history retained. Remaining losses and later recoveries
stay recorded.

## Cross-chain collateral

Each source chain has a CollateralVault and versioned onchain light-client
verification in both directions. Each verifier validates the other chain's
consensus finality and state inclusion under its registered consensus rules:

```text
Source lock -> source finality -> proof on Monad -> collateral binding
Monad release or recovery -> Monad finality -> proof on source -> vault release
```

Configuration fixes verifier code, consensus rules, bootstrap checkpoints and
their trust assumptions, validator-set updates, proof format and age, reorg
handling, and keeper fees. Keepers transport proofs; keeper or application
signatures do not establish finality. A source chain is eligible only after both
verification directions and their failure paths have been validated.

Each collateral market publishes an admission manifest identifying the concrete
verifier implementations, reproducible source and code hashes on both chains,
supported consensus versions, bootstrap procedure, and proof-generation software.
It records measured proof-generation time, finality delay, proof size, and onchain
verification gas for ordinary proofs and validator or committee updates. Configured
proof ages, setup deadlines, keeper budgets, and recovery haircuts must accommodate
those measurements and the accepted outage assumptions.

Admission requires deployment evidence for lock and top-up inclusion on Monad,
release and recovery authorization on the source chain, and confirmations back to
Monad. Tests include forged state, wrong chain or contract, replay, consensus-set
updates, stale proofs, interrupted relaying, late locks, and expired releases.
Both directions must fit their chain's execution budget. An unproven direction
keeps that collateral market disabled; a generic bridge listing or provider chain
support does not qualify a collateral verifier.

Each Credit pins its verification versions under the governance and migration
rules. Messages bind both chain and contract identities, Credit, `lock_id`,
release kind, revision, nonce, asset, amount, recipient, and expiry. Initial lock
and abort-return processing follow the setup deadline and late-proof rules.

If a verifier is paused or finalized-state progress exceeds its permitted age,
Core freezes affected draws, risk increases, and borrower asset releases. Direct
repayment and independently verifiable safe exits remain available. Pending
returns stay pending; unavailable verification cannot be replaced by an admin
signature, local timeout, or indexer result. Resumption requires valid finalized
state and reconciliation of outstanding messages before restrictions are lifted.

Source liquidation defines seizure authority, auction or sale rules, minimum
proceeds, settlement destination, deadlines, and failed-sale recovery. Proceeds
in transit remain pending until received by HouseVault. A transfer provider may
move value; it cannot replace custody or release proofs. Remote collateral is
delayed recovery backing and is valued accordingly.

## Cross-chain value routing

Termbook integrates Aurora Intents for three routes. Each converts a supported
source asset into the House's settlement asset on Monad:

| Route                       | Source                                                  | Final accounting                                                                         |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Remote liquidation proceeds | Authorized source recovery vault after collateral sale. | Recovery credited to the originating Credit and HouseVault.                              |
| Remote repayment            | Borrower or authorized payer on another chain.          | Payment allocated to the bound Credit's outstanding claims.                              |
| Cross-chain LP deposit      | LP funding wallet on another chain.                     | Deposit accepted by the selected HouseVault and shares minted to the bound LP recipient. |

Remote recovery requires an admitted value-transfer route. Remote repayment and
LP funding are optional alternatives to direct Monad settlement. Collateral
activation, release, and recovery authority use the collateral verification rules.
House draws, Credit Accounts, and financed application execution remain on Monad.

### Route admission

Each route version pins its Aurora integration interface, assets, chains,
SettlementInbox factory and code, permitted bridge paths, trust assumptions,
fees, source funding limits, and settlement and refund behavior. Validation checks
the actual asset pair, contract-originated funding where needed, destination
contract receipt, and available liquidity at the admitted sizes. Source recovery
must work without the borrower's signature. A quote cannot silently select a path
outside the admitted trust assumptions. An interface that cannot enforce the
required restrictions is ineligible for that route.

[Aurora Intents](https://intents.aurora.dev/) supplies the execution service. Its
underlying [NEAR Intents bridge routes](https://docs.near-intents.org/integration/bridging/overview)
have route-specific trust models; their asset-transfer support is separate from
Termbook collateral-verifier admission.

### Register and fund

Before source funding, register an authorized operation on Monad with:

- a unique `operation_id`, operation kind, authorizer, nonce, and route version;
- source chain, asset, payer or recovery vault, and `max_amount_in`;
- destination chain, settlement asset, HouseVault, and its servicing version;
- `credit_id` for repayment, plus the recovery identifier for liquidation;
- the LP's Monad share recipient for a deposit;
- expected output, `min_amount_out`, quote expiry, and settlement deadline;
- fixed `source_refund_recipient` and `monad_refund_recipient`, with the rules below.

Repayment registration also binds the cumulative payment cap and permits applying
late or partial receipts to that Credit. Recovery registration binds the recorded
claim and surplus allocation. LP registration includes its amount bounds,
`min_shares`, and deposit authorization revision.

The registered factory creates a separate SettlementInbox with immutable code and
fixed operation identity and recipients. The registration authorization binds all
operation fields, the Monad chain and factory, nonce, and authorization deadline.
The Aurora quote must name that inbox as the destination. The SDK checks the quote
against the registration before obtaining source funding authorization.
The funding wallet authorizes its source transfer; an app token or caller-supplied
operation identifier cannot assign another payer's funds or change recipients.
Supported wallet signature schemes and their authorization binding are validated
as part of route admission.

Each quote authorizes one funding attempt. Before another source funding attempt,
reconcile the previous operation and obtain a fresh quote, authorization, nonce,
and inbox under a new operation bound to the same Credit, recovery, or LP. Repeating
settlement of an existing receipt uses its existing inbox and needs no new funding.
Recovery refunds remain in the bound source recovery vault or Monad recovery
inbox. Borrower and LP refunds use the recipients they authorized.

### Receive and apply

```text
Register operation and inbox on Monad
-> fund the approved Aurora route on the source chain
-> settlement asset arrives at that operation's Monad inbox
-> apply to HouseVault and update debt or mint shares atomically
```

The inbox accepts delivery without requiring a callback from the transfer provider.
Anyone may submit its registered settlement or refund operation; they cannot
change its recipients or terms. Onchain balances and cumulative amounts already
applied or refunded determine the unconsumed receipt. Provider status, a relayer
signature, or an API transaction hash alone cannot credit a payment or mint shares.
Repeated finalization cannot consume the same amount twice or move value between
operations. Settlement and refund entry points share a reentrancy guard and record
amount consumption in the same transaction as the outgoing transfer. Transfer-tax
and rebasing settlement tokens are ineligible.

Inbox assets belong to the operation until successfully applied. They contribute
no House free cash, LP share value, or debt reduction. Transfer to HouseVault and
its corresponding accounting or share mint occur in one Monad transaction. If
that transaction fails, the funds remain in the inbox with their original claim.
Unrecognized tokens create no House credit; bounded recovery may return them only
to the operation's fixed recipient for that kind of funds.

### Shortfalls, expiry, and refunds

Quote expiry stops new authorized source funding. It does not undo an accepted
transfer. A settlement deadline determines the action permitted on arrival; it
does not delete the operation or its custody obligations. Delivery, application,
refund, and unresolved amounts are tracked separately from provider status.

| Condition                                                     | Required behavior                                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No funds received; route failed or expired                    | No House credit or shares. Track source refund or unresolved source funds until reconciled.                                                                    |
| Repayment arrives late or below the quoted output             | Apply the received settlement asset to the same Credit within the operation's remaining cumulative payment cap; report the route shortfall and remaining debt. |
| Recovery proceeds arrive late or in parts                     | Apply each unconsumed receipt to the recorded recovery claims, including later recoveries after a write-off. Remaining recovery remains tracked.               |
| LP output or mint conditions fail                             | Keep funds refundable in the inbox; mint no shares. Apply the LP deposit rules below.                                                                          |
| Duplicate delivery notification or settlement call            | Re-read unconsumed custody and recorded allocations; never repeat an earlier credit, mint, or refund.                                                          |
| Unexpected receipt after an operation was considered finished | Reopen receipt reconciliation under the original binding; apply or refund the new amount without reopening the Credit or changing recipients.                  |

Repayment and recovery authorizations explicitly permit accounting for actual
receipts on a route shortfall. This does not waive `min_amount_out`, relax a signed
source trade limit, or mark the provider's delivery as successful. Outstanding
claims remain unpaid until actual HouseVault settlement. Fully paid borrower
Credits return excess to the bound Monad refund recipient; recovery overpayments
follow the Credit's recovery waterfall and surplus rights.

Source refunds and destination refunds are different obligations. Aurora source
refunds follow the admitted provider path and go to the bound source recipient.
Funds already on Monad are refunded in the settlement asset on Monad, without
requiring a working bridge or another conversion. The interface discloses both
refund destinations and assets before funding. A failed or partial provider refund
cannot erase a receipt or a refund claim held in Termbook custody.

For example, if a 1,000 USDC repayment route delivers 900 USDC, settlement may
apply 900 USDC to the outstanding claims. The interface reports the unpaid balance
and any interest accrued during transit. It never reports the full 1,000 USDC as
paid. Funds held in a recovery inbox remain restricted even if the route fails.

## House economics and LP accounting

Each House uses one settlement asset. Its accepted terms specify:

- fixed or variable rate calculation, including any rate source and bounds;
- accrual start, time basis, compounding, rounding, and default treatment;
- duration start and the resulting maturity;
- fee bases, collection times, caps, refunds, and repayment allocation;
- revolving treatment and commitment-fee accrual;
- reserve funding, first-loss claims, and recovery allocation.

Interest starts only on actual draws. Setup reservation charges follow the funded
bond rules. A commitment fee can apply to undrawn capital after readiness. Bond
refund liabilities are excluded from free LP cash and share value; earned charges
enter House assets only after their allocation is accounted for. Application
profits, rewards, and yield belong to the borrower after obligations and required
buffers, unless the Quote states another split.

HouseVault separately tracks free cash, committed cash, drawn principal, accrued
receivables, pending settlement, funded reserves, impairment, and realized loss.
Transfers between these categories do not create new assets. Pending proceeds
cannot also count as received cash or an unreduced receivable.

Share pricing uses current conservative asset value less recognized losses and
liabilities. Deposits and exits use the same valuation basis. Impairment is
recorded before exits can transfer known losses to remaining LPs. House policy
defines share conversion and rounding, reserve ownership, queue priority,
cancellation, and who may recognize or reverse impairment.

### LP deposit settlement

An LP may deposit the House settlement asset directly on Monad or use the
registered Aurora Intents route. The LP authorizes the HouseVault and version,
share recipient, settlement asset, amount bounds, `min_shares`, `deposit_deadline`,
and refund recipients. For a cross-chain deposit, these terms are bound to the
routing operation; `deposit_deadline` is its settlement deadline. The source payer
authorizes the destination share and refund recipients even when those addresses
belong to a different wallet.

A cross-chain deposit collects the operation's net settlement-asset receipts in
its inbox. It may mint once, before the deadline, only when the authorized deposit
amount bounds and `min_amount_out` are met, deposits are open, and the current
share conversion yields at least `min_shares`. Share pricing uses conservative
House asset value immediately before this deposit, after required accrual and
impairment updates. The incoming amount is excluded from that pre-deposit value.
Transfer to HouseVault, deposit accounting, and share minting are atomic. A zero
share result is rejected. Bootstrap, rounding, and unsolicited-transfer rules must
prevent donations or a first depositor from bypassing the LP's conversion bounds.

An expired deposit, failed minimum-share check, paused House, or failed mint leaves
the funds in the inbox with an enforceable refund claim. The LP may authorize
cancellation before minting. After that cancellation or the deposit deadline,
anyone may return available funds to the fixed Monad refund recipient. Until then,
an incomplete receipt remains pending; an unrelated caller cannot force an early
refund because only part of the transfer has arrived.

Before cancellation, minting, or refund, the LP may authorize revised bounds and
a new deadline through a fresh authorization revision. That revision races atomically with
minting or refund and cannot consume an already-settled receipt or authorize
another source transfer. Neither a keeper nor the interface may reduce `min_shares`
or extend the deadline without consent. Cancellation prevents minting and sends
subsequent receipts through the refund path.

After a successful mint or refund, additional late receipts are refundable under
the same operation and cannot mint again. The LP may initiate a separate deposit
after receiving the refund. Pending and refundable inbox balances earn no House
yield, create no House shares, and remain outside lendable House cash. A failed
provider route does not remove a refund claim for funds already held in the inbox.

Withdrawals settle from free cash or enter the disclosed queue. Committed funds
remain reserved until drawn or released. Later recoveries follow a published
claim rule that defines the rights of affected LPs, including those who exited.
Losses and recoveries never cross House boundaries.

## Governance, integrations, and emergencies

| Authority                    | Scope                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Borrower primary wallet      | Accept terms, manage sessions, and authorize policy changes.                                                                                                             |
| Application owner            | Submit deployment information and integration candidates.                                                                                                                |
| Integration review authority | Approve reviewed versions and their registered execution and recovery paths.                                                                                             |
| House manager                | Sign offers, select approved integrations, and manage House policy within global limits.                                                                                 |
| Guardian                     | Apply scoped pauses and accepted emergency controls.                                                                                                                     |
| Protocol governance          | Publish new Core and verifier versions, manage admission limits and registries, and apply disclosed timelocks. Existing Credits remain bound to their accepted versions. |
| Keepers and liquidators      | Submit eligible proofs and registered recovery operations.                                                                                                               |

Deployment configuration must publish authority addresses, key rotation,
timelocks, and emergency exceptions. Each Credit pins an immutable servicing
Core implementation and custody guards. Version bindings can change only through
the authorized migration path. Core and verifier upgrades deploy new versions;
they cannot overwrite implementation code or custody rules for a live Credit,
or bypass its accounting through an administrative update.

HouseVault custody guards authenticate the House-authorized Credit allocation,
its servicing Core, draw limits, and repayment accounting. CollateralVault guards
enforce the bound verification version, lock consumption, release authority, and
recipients. Credit Account guards preserve policy, ownership, and recovery
restrictions. These guards cannot be bypassed by a registry change, proxy upgrade,
or administrative transfer function. Bond custody and refunds follow the same
version and recipient protections.

SettlementInbox guards preserve operation identity, House and Credit binding,
share and refund recipients, and consumed amounts. Only the registered LP
authorization path can revise unconsumed deposit bounds. Adapter upgrades or
administrators cannot redirect escrowed funds or remove an existing refund claim.

Migration requires borrower and House authorization, reconciled debt and pending
operations, verified custody on both chains, and post-migration health. Source
authority changes require the collateral owner's authorization. The old servicing
path remains available until obligations transfer without duplicate draw or
release authority. A timelock alone cannot substitute for these protections.
Emergency powers may restrict new risk or invoke accepted recovery paths; they
cannot redirect protected assets or replace accepted economic terms.

An application is eligible only after its exact deployment passes the
[integration acceptance process](#acceptance-gate). Each House
then opts into the exact version and exposure limits.

Live dependencies must preserve accepted execution and recovery behavior through
immutable code or enforceable upgrade controls with a validated exit or migration
path. Offchain monitoring detects changes; it cannot prevent an external upgrade.
Dependencies without adequate controls are ineligible. An upgrade exit window
must cover the validated unwind, queue, and proof duration with a safety margin.
Where exit duration cannot be bounded, an enforceable migration or continued safe
servicing path is required. Migrations follow the authorization and custody rules
above.

Pauses may apply to an integration, House, collateral market, oracle, or global
dependency. They stop affected new risk. Repayment remains available. Cancellation
and exits proceed when their required state, prices, and application paths work.
With stale prices, use only explicitly approved fallback or price-independent
paths. Other actions wait while the account remains frozen and losses are assessed.

## State and tracking

State has separate dimensions:

| Dimension         | States                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facility          | `reserved`, `collateral_locking`, `collateral_proving`, `account_creating`, `ready`, `closing`, `closed`, `aborted`, `liquidating`, `recovery_pending`, `liquidated` |
| Action            | `idle`, `submitting`, `pending`, `settled`, `cancelled`, `failed`, `expired`                                                                                         |
| Payment           | `undrawn`, `current`, `matured`, `defaulted`, `repaid`                                                                                                               |
| Risk              | `healthy`, `watch`, `frozen`, `liquidatable`                                                                                                                         |
| Accounting        | `performing`, `watch`, `impaired`, `charged_off`, `partially_recovered`, `recovered`                                                                                 |
| Collateral return | `none`, `pending`, `complete`, tracked per lock and return operation.                                                                                                |

| Transition                                    | Required condition                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup → `ready`                               | Valid collateral proof, account binding, and accepted policy; bond settled and reservation converted to a facility commitment before the setup deadline. |
| Setup → `aborted`                             | No draw or application liability; bond settled, reservation released, and return obligations recorded.                                                   |
| `aborted` → `aborted` after a late lock proof | Finalized unreturned deposit verified; lock-specific return authorized without restoring credit or commitment.                                           |
| `ready` → `ready` after an action             | Execution or pending exposure recorded; all applicable checks pass.                                                                                      |
| `ready` → `closing`                           | Closure authorized; all draws and risk increases blocked, trading sessions revoked, and commitments released.                                            |
| `closing` → `closed`                          | House claims settled, pending actions resolved, account release or unwind complete, and surplus and source-collateral returns confirmed.                 |
| Open facility → `liquidating`                 | Core confirms recovery eligibility.                                                                                                                      |
| `liquidating` → `recovery_pending`            | A registered exit is awaiting settlement.                                                                                                                |
| Partial recovery → `ready`                    | Cure conditions verified before maturity; recovery settled, maintenance health or debt-free checks passed, and remaining commitment reconciled.          |
| Full recovery → `liquidated`                  | Termination completed, recovery steps reconciled, and remaining claims and losses recorded.                                                              |

Payment and accounting updates do not erase recovery claims. Repayment can restore
revolving capacity while facility state remains `ready`. Recovery suspends its
use until a verified cure. Closure and full termination end it. A charge-off does
not cancel a later recovery. An aborted Credit may have pending collateral returns;
the UI reports both states and continues reconciliation until returns are complete.

Core state is authoritative. Events record transitions for indexing, with chain,
block, transaction, Credit, revision, and relevant operation identifiers. Indexers
handle reorgs and never replace contract checks. Errors include a stable code,
readable reason, operation status, and safe next action.

## Application integrations

An integration connects an application deployment to Termbook's execution,
valuation, and recovery rules. Each published IntegrationVersion is immutable.

### Onboarding

#### 1. Register the application

Create an application in the dashboard. Supply its name, origin, owner, and
environment. Verify the owner and origin before publication.

The public app token resolves this configuration. It grants no administrative,
borrower, or execution authority.

#### 2. Import the deployment

Select a category and Monad environment. Supply a canonical entry address or a
deployment manifest. The Integration Builder imports deployed code, verified
source, ABIs, known proxy information, and explicit configuration getters.

Approval requires reproducible source that matches the deployed implementation.
An ABI alone establishes encoding, not behavior.

#### 3. Map execution paths

Provide reference transaction hashes for each distinct path. A recorder may
submit hashes from the application's test wallet. The Builder decodes calls,
logs, transfers, and available traces to propose capability mappings.

Confirm the business meaning, units, account identity, ownership, liabilities,
state getters, permissions, and recovery recipients. Automated or AI-generated
mappings remain drafts until reviewed and tested.

#### 4. Define capabilities

Each capability specifies:

| Field            | Required information                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs           | Typed borrower inputs, fixed values, policy values, and units.                                                                        |
| Risk effect      | Increase, neutral, or decrease, with runtime validation.                                                                              |
| Calls            | Target, selector, value, parameter sources, return rules, and callbacks.                                                              |
| Approvals        | Registered spender, amount bounds, and allowance cleanup.                                                                             |
| State            | Ownership and liability readers, preconditions, and postconditions.                                                                   |
| Execution bounds | Maximum tracked positions, pending actions, assets, claims, dependency depth, and calls; slots required by submission and settlement. |
| Settlement       | Atomic or asynchronous behavior and authoritative completion state.                                                                   |
| Recovery         | Cancellation, reduction, full exit, settlement, and debt-free release.                                                                |

Parameter sources are limited to borrower inputs, account identity, accepted
policy, registered integration data, and verified application state. Borrower
inputs cannot supply arbitrary targets, calldata, or recipients.

The shared FlowExecutor handles flows whose complete rules it can enforce.
Other flows require a reviewed AppGateway. The gateway constructs calls; the
bound Credit Account executes them as the application's caller.

#### 5. Validate and publish

Test with an actual Credit Account, from the smallest application-valid amount
through the maximum supported portfolio and pending-action counts. Use the same
account, signer, role, relayer, and permission model required in production.
Recovery tests run without borrower cooperation and within the chain's execution
budget, including when settlement requires several bounded transactions.

After the acceptance gate passes, publish the manifest with its chain, addresses,
code identities, capabilities, readers, dependencies, policy constraints, and
evidence hash. Each House then approves the published version and its exposure
cap before funding a Credit.

### Capability requirements

| Category  | Typical capabilities                                                                                                     | Required recovery control                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Perps     | `place_order`, `increase_position`, `decrease_position`, `add_margin`, `remove_margin`, `cancel_order`, `close_position` | Read margin, positions, funding, senior liabilities, and pending exposure. Cancel or close and return released funds to the Credit Account. |
| Staking   | `stake`, `claim_rewards`, `request_unstake`, `complete_unstake`, `withdraw_to_credit_account`                            | Own the receipt or enforceable withdrawal claim. Account for slashing, queues, and unbonding delay.                                         |
| Vault     | `deposit_vault`, `redeem_vault`, `claim_rewards`, `withdraw_to_credit_account`                                           | Own shares and redeemable claims. Verify fees, liquidity limits, queues, and withdrawal recipients.                                         |
| Liquidity | `add_liquidity`, `remove_liquidity`, `stake_lp`, `unstake_lp`, `claim_rewards`, `collect_fees`                           | Own LP tokens or position NFTs and their proceeds. Value the full unwind under stressed liquidity.                                          |
| Spot      | `swap_exact_in`, `swap_exact_out`, `sell_to_settlement`                                                                  | Return outputs to the Credit Account. Require approved pricing and an executable recovery market.                                           |

Capability names describe economic effects. An integration may map several
capabilities to one application function with different validated parameters.
The SDK example uses `place_order` to open a perps position.

Perps inputs use one sizing mode: margin plus notional, or margin plus leverage.
The third value is derived. Applications with different sizing rules must define
their units and calculation explicitly.

The public perps shape groups amounts under `amount: { margin, notional }` for
opening and increasing a position. An increase specifies additions, not new totals.
A decrease specifies the notional to remove. `add_margin` and `remove_margin`
adjust margin without changing notional. All seven public capabilities are shown
in the [trading lifecycle examples](#trading-capabilities).

Account creation, initial application deposits, and settlement collection are
internal integration steps. A close or cancellation includes the required return
of released assets. Deliberate `remove_margin` is a separate borrower action,
available only when application and Termbook health permit it.

Standard vault interfaces can reduce mapping work. Each deployed vault and its
asset, share token, limits, fees, and upgrade controls still require approval.
Assets without approved pricing and an executable exit have zero recovery value.

### Account permissions and runtime state

The Credit Account must own the application account or position, or hold an
enforceable senior claim. Separate per-Credit proxies are allowed only with the
same custody and recovery restrictions. Accounts cannot be reinitialized or
reused across Credits.

Record required factories, operators, roles, allowlists, signers, and relayers.
Include their administrators, revocation paths, and upgrade dependencies.
Contract-signature support, including ERC-1271 where relevant, must be tested.
An EOA-only requirement is ineligible if it prevents controlled account execution
or borrower-independent recovery.

Runtime verification uses contract returns, account balances, registered onchain
getters, approved oracles, and Core state. Traces, explorer data, historical logs,
and application databases are development and monitoring tools. They cannot
replace authoritative ownership, position, or liability reads.

Approvals go directly from the account to registered spenders. Handle tokens
that require allowance reset. Unlimited approval to a shared gateway is forbidden.

### Asynchronous settlement

Each asynchronous capability defines:

- pending identifiers, state readers, and authorized executors;
- maximum duration, committed funds, and worst-case exposure;
- partial fills, cancellation races, failure, expiry, and final settlement;
- refund and settlement recipients;
- idempotent reconciliation, retries, and overdue recovery;
- actions allowed while funds or positions remain pending.

Tests must cover a fill that leaves the Credit unsafe, a failed cancellation,
duplicate finalization, and a refund arriving after an earlier partial fill.
The [protocol's asynchronous rules](#asynchronous-actions) govern
debt and recovery throughout the flow.

### Dependencies and upgrades

Asset conversion and multi-step strategies use an approved integration bundle.
Each dependency pins its version, targets, assets, recipients, pricing, slippage,
and recovery route. The bundle is validated as a whole. Assets cannot leave its
controlled custody boundary between steps.

An implementation, permission, signer, oracle, or material configuration change
invalidates affected evidence. Stop new risk until the replacement passes review.
Retain the old executable path or use a tested, authorized migration or unwind.
An old manifest cannot make an upgraded external contract behave like its old code.

Integration states are `draft`, `mapping`, `ready_to_test`, `validating`,
`security_review`, `active`, `frozen`, and `revoked`. Frozen or revoked versions
block new risk. Recovery may use only paths still verified safe; revocation does
not authorize execution of compromised code.

### Acceptance gate

Approval requires evidence for every applicable requirement:

1. Source, bytecode, gateway, and dependency identities match the deployment.
2. Account ownership and all required permissions work with Termbook identities.
3. Targets, selectors, parameters, approvals, callbacks, and recipients are bounded.
4. Replay, reentrancy, unauthorized modules, and ownership escapes are rejected.
5. Current positions, pending exposure, and senior liabilities are readable onchain.
6. Pricing validates feed identity, freshness, decimals, confidence, and deviation.
7. Valuation accounts for the whole portfolio, costs, liabilities, and recovery delay.
8. Borrower-independent cancellation, reduction, closure, and settlement work.
9. Async, pause, stale-oracle, permission-loss, and upgrade failure paths are tested.
10. Debt-free position release or mandatory unwind is defined and tested.
11. Recovery recipients and every dependency preserve House isolation.
12. Public action schemas, derived draw and slippage bounds, and all supported
    trading capabilities are tested against the exact deployment. Funding tests
    include financed fees, conversion costs, and insufficient explicit limits.
13. Closing or cancelling returns released funds without a separate borrower
    collection call. Closure confirms surplus and source-collateral return,
    including interruption, duplicate submission, and failed-transfer cases.
14. Full closure can unwind and repay from an account with no initial free cash.
    The retention path never sells a position without authorization. Closing and
    recovery reject risk increases funded from existing account cash.
15. Partial recovery can reach a verified cure; maturity, unresolved defaults,
    unsettled recovery, and full termination prevent an invalid return to `ready`.
16. Maximum portfolio and pending-state sizes fit execution budgets. Slot
    reservations, partial fills, duplicate claims, unsolicited assets, and
    interrupted recovery cannot bypass bounds or make recovery unexecutable.

The supporting protocol deployment must also validate bond collection and refund
accounting, setup expiry, locks finalized or proved after abort, duplicate return
proofs, verifier outages, and rejection of thresholds below the protocol floor.
Upgrade and migration tests must show that live Credits cannot acquire replacement
servicing or release authority without the required authorizations, or retain
duplicate authority after migration.

Value-routing tests must show that transfers to each inbox are attributable to
only its bound operation. Cover duplicate finalization, multiple and late receipts,
source refunds, partial repayment, changing debt during transit, concurrent direct
repayment, excess payment after closure, and recovery after a write-off. Destination
settlement failures must preserve inbox custody and prevent accounting changes.
Recovery retry and refund tests must preserve lender control without borrower
cooperation.

LP tests must cover a changed share price between quote and mint, `min_shares`
failure, expired authorization, paused deposits, zero-share rounding, first-deposit
and donation manipulation, premature refund attempts on partial receipts, refund
versus mint races, authorized revisions, wrong share recipients, and receipts
after a prior mint or refund. Assertions reconcile
all received value among applied funds, refunds, and outstanding inbox balances.

Each result records version, code snapshot, environment, account, roles, funder,
inputs, transaction hashes, block references, before/after state, and assertions.
Successful transactions alone do not prove correct ownership or recovery.
Fork tests are identified separately from exact-deployment permission checks.

## Deployment admission

A deployment publishes the exact supported combinations of collateral market,
value route, House settlement asset, and application integration. Registries reject
offers and new funding for combinations without accepted validation evidence.
Protocol and House risk parameters are concrete versioned configuration, including
oracle feeds, freshness limits, haircuts, thresholds, exposure caps, keeper budgets,
and execution bounds. Illustrative SDK assets and markets do not establish support.

| Component               | Required admission evidence                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collateral market       | Both concrete verifier deployments, measured proof costs and latency, and the full lock, release, recovery, and confirmation cycle.                                                |
| Aurora value route      | Exact integration interface and bridge assumptions, supported asset pair, funding authorization, inbox delivery, accounting, refunds, and failure reconciliation.                  |
| Application integration | Exact Monad deployment, restricted account ownership, authoritative liabilities and valuation, and a complete recovery executed without borrower cooperation.                      |
| House                   | Settlement asset, funded liquidity and disclosed reserves, enabled component versions, risk configuration, and verified deposit, draw, repayment, loss, and withdrawal accounting. |

The first admitted combination must demonstrate the full path: verified source
collateral, House reservation, restricted account draw, actual application action,
position exit, repayment, and confirmed collateral return. A separate recovery
exercise must freeze the account, unwind the application, recover source collateral,
return proceeds through the admitted value route, and reconcile House claims and
borrower surplus. LP funding must demonstrate both share minting and an executable
refund after a failed mint condition. All exercises record the acceptance evidence
above and include interruption and resumption.

Component admission is independent. An Aurora-supported chain may be eligible for
LP funding or repayment while remaining ineligible for collateral. A collateral
market requiring remote recovery also needs an admitted recovery value route.
An application with unavailable ownership, liability, or recovery control stays
disabled. It must pass with a suitable reviewed integration or be replaced by an
eligible deployment; live House funds cannot be used with an unverified path.

## Embedded interface

Applications embed one Termbook launcher and a modal with Account and App tabs.
The application may pass a prepared action. The modal owns offer selection,
collateral setup, execution review, and facility management.

### Launcher and routing

Use **Use Termbook** before a facility exists and **Open Termbook** afterwards.
Keep the label stable. Show actionable risk status beside it.

| Context                            | Initial view                                                  |
| ---------------------------------- | ------------------------------------------------------------- |
| Prepared action                    | Compact trade and financing review in the App tab.            |
| Compatible ready Credit, no action | App tab.                                                      |
| No Credit or action                | Account tab.                                                  |
| Explicit tab selection             | Requested tab, with account and action compatibility checked. |

Both tabs remain available. A compatible existing Credit skips new offers and
setup. If several qualify, the borrower selects one. A pending Credit resumes
setup instead of creating another reservation. Houses cannot be combined inside
one account or position.

### Account tab

Show facility limit, available credit, principal, interest, fees, source
collateral, recoverable application value, withdrawable surplus, safety buffer,
maturity, and status. Provide top-up, repayment, safe withdrawal, and closure.

During setup, collect source wallet, chain, asset, amount, and duration. A prepared
action supplies its funding requirement; each offer includes its financed costs
and proposed facility limit. The borrower may set an explicit limit cap. Without
a prepared action, collect the limit directly. Registered integration rules
provide units and conversion requirements for every category.

**Find offers** shows up to five compatible House cards under the offer rules.
Each includes usable action funding, financed costs, facility limit, APR, fees,
estimated cost and assumptions, commitment treatment, collateral requirement,
duration, and recovery terms. Show the setup bond, its funding source, refundable
amount, and abandonment or expiry charges before acceptance. Sponsor funding must
be confirmed as available; otherwise the borrower supplies the required bond.
Disclose sponsored ranking. A card opens the terms; it does not accept them.

**Accept offer** requests the required wallet approvals and coordinates bond
funding, reservation, locking, proof verification, and account setup. Show each
pending step and resume confirmed work after interruption. Once ready, return to
the compact review of the saved action. If there was no action, show the
capabilities allowed by the selected Credit.

If no offer qualifies, explain the limiting condition. The borrower may adjust
collateral, credit, or action inputs and request fresh offers. Never change the
requested trade silently.

### App tab

For a prepared action, show a compact summary of the selected trade and its
financing. An explicit **Edit trade** opens the registered inputs. The saved draft
is the sole action under review. Edits in either interface require a fresh draft,
funding check, and execution authorization. A previously signed action can be
replaced only after its authorization is consumed, expired, or revoked onchain.
An already-submitted action follows its recorded lifecycle and requires registered
cancellation or replacement; editing the UI cannot undo it. Changed funding or
policy requirements are checked against the selected Credit or fresh offers
before confirmation.

Without a prepared action, render inputs from registered capability schemas.
Ongoing management shows positions, pending actions, and the trading controls
supported by the integration and accepted policy. Opening, increasing, reducing,
margin adjustment, cancellation, and full closure are separate borrower choices.

Before execution, show the required draw, resulting debt, fees, exposure, slippage,
and recovery health. Derive leverage from margin and notional. Refresh prices and
terms after setup or edits, then obtain authorization through **Confirm trade** or
the relevant application action. Setup never executes the saved trade automatically.

Termbook renders the tab. Application metadata cannot inject runtime JavaScript,
targets, calldata, or state readers. The native application may display positions
and prepare typed actions; execution uses the Termbook SDK path.

### Progress and closure

Show confirmed transactions, remaining steps, and required wallet actions.
Submission is distinct from settlement. An order that fails, expires, or is
cancelled must not appear as a completed trade. Modal dismissal stops UI activity,
not onchain work.

Remote payments show source funding, Monad inbox receipt, and HouseVault allocation
as separate steps. Show actual applied amounts, remaining debt, and refund claims
even when the provider reports failure or expiry. Source and Monad refunds show
their respective assets and recipients. The same progress rules apply to LP
funding; the deposit review includes estimated and minimum shares, the minting
deadline, and the Monad refund destination. A failed mint presents refund or fresh
deposit authorization through the same operation. The interface cannot display
inbox funds as a completed repayment or an earning LP deposit.

Show one Termbook health measure with its components and thresholds. Use text and
numbers alongside color. Health is not applicable when debt is zero. Application
margin health remains separate from Termbook recovery health.

After proceeds or refunds settle, show remaining debt, free cash, and continuing
interest. Present the permitted repayment or reuse choice and its effect on draw
capacity. An empty position list never implies that debt has been repaid.

On exit, show the authorized unwind or supported retention choice, estimated
proceeds, debt, any shortfall, borrower surplus, and both return destinations.
**Close facility** coordinates pending orders, unwind or retention, repayment,
surplus payout, and source-collateral return. It requires no preceding repayment
or position-close button. Keep the Credit `closing` until all required returns
are verified. Display finality and proof progress within that operation; no
separate claim button is required. After setup abort, show any remaining
collateral return, including deposits discovered late. Liquidation progress,
successful cure, and losses remain distinct from voluntary closure.

## SDK reference

The application calls `open()`. The modal coordinates the lifecycle through
Intent, Credit, and typed application actions. Contract signatures, proof steps,
execution review, and progress tracking are handled internally.

### Open with a prepared trade

```ts
import { create_termbook } from "@termbook/sdk";

const termbook = create_termbook({ app_token, wallet });

const trade = {
  market_id: "ETH-USD",
  direction: "long",
  margin: 700_000_000n,
  notional: 1_050_000_000n,
};

termbook.open({
  action: {
    capability: "place_order",
    params: {
      market_id: trade.market_id,
      direction: trade.direction,
      order_type: "market",
      amount: {
        margin: trade.margin,
        notional: trade.notional,
      },
      slippage_bps: 50,
    },
  },
});
```

This example uses 700 USDC margin, 1,050 USDC notional, and 0.5% slippage.
`ETH-USD` is an illustrative registered market ID. The example integration uses
six-decimal margin and notional units. Actual IDs, units, and capabilities come
from the published integration.

`app_token` is public configuration. It identifies the application and published
integration. The wallet supplies borrower identity. Existing Credits keep their
accepted versions when application configuration changes.

### Open without a prepared action

```ts
termbook.open();
```

The modal collects collateral and credit terms, guides offer acceptance, and then
collects application inputs. If a compatible Credit already exists, it opens its
App tab. An action is optional for facility creation.

### Request credit and execute

The following code belongs inside the modal. `action` is the object received by
`open()`, and `collateral` is the borrower's selection. With a prepared action,
omitting `credit.limit` requests offers for its complete funding requirement.
Each offer fixes an explicit limit including its financed costs for borrower
review. The modal may instead supply a borrower-confirmed `credit.limit` cap;
offers and execution must respect it.

```ts
const intent = termbook.intent({
  collateral,
  credit: {
    duration: 30 * 86400,
  },
  action,
});

const offers = await intent.offers();

const credit = await intent.accept({
  offer_id: selected_offer.id,
});

const result = await credit.app.execute(action);
```

`collateral` contains `chain_id`, `asset`, `amount`, and an optional `owner` that
defaults to the borrower. Locking requires that owner's source-wallet approval.
The duration is in seconds. Without a prepared action, the modal must supply
`credit.limit` and duration and omit `action` from the Intent. The bond and other
costs payable separately are reviewed with their funding sources before acceptance.

The modal pauses for offer selection and each authorization. `offers()` returns
up to five compatible offers. `accept()` resolves to a ready Credit after setup.
`execute()` obtains a fresh review and authorization, calculates the required
draw, and returns the confirmed action outcome. These are separate borrower steps.
There is no required public preview, collateral-lock, or readiness-wait call.

For an existing compatible Credit, the modal uses it directly:

```ts
const credit = termbook.credit(selected_credit.id);

const result = await credit.app.execute(action);
```

### Trading capabilities

`place_order` is shown above. The remaining operations below are independent
controls, not a script to run in sequence. The modal supplies the selected
position or order. Each operation must fit the Credit's available funds, exposure,
health, and integration limits.

Increase an existing position. Both amounts are additions:

```ts
await credit.app.execute({
  capability: "increase_position",
  params: {
    position_id: selected_position.id,
    amount: {
      margin: 100_000_000n,
      notional: 150_000_000n,
    },
    slippage_bps: 50,
  },
});
```

Reduce the specified notional:

```ts
await credit.app.execute({
  capability: "decrease_position",
  params: {
    position_id: selected_position.id,
    amount: {
      notional: 300_000_000n,
    },
    slippage_bps: 50,
  },
});
```

Add margin without increasing notional:

```ts
await credit.app.execute({
  capability: "add_margin",
  params: {
    position_id: selected_position.id,
    amount: 100_000_000n,
  },
});
```

Return safely removable margin to the Credit Account:

```ts
await credit.app.execute({
  capability: "remove_margin",
  params: {
    position_id: selected_position.id,
    amount: 50_000_000n,
  },
});
```

Cancel an order's unfilled remainder and return refundable funds:

```ts
await credit.app.execute({
  capability: "cancel_order",
  params: {
    order_id: selected_order.id,
  },
});
```

Close the entire position and return its released settlement funds:

```ts
await credit.app.execute({
  capability: "close_position",
  params: {
    position_id: selected_position.id,
    slippage_bps: 50,
  },
});
```

Reduction, cancellation, margin removal, and closure include their registered
settlement steps. They never transfer protected funds directly to a borrower
wallet. Application delays remain visible until the required returns settle.

### Withdraw profit, repay, and close

The borrower may withdraw permitted surplus while keeping the facility open:

```ts
await credit.account.withdraw({
  asset: settlement_asset,
  amount: 50_000_000n,
});
```

The recipient is fixed by the Credit. Core checks current `max_withdrawable`,
liabilities, pending actions, and House profit rules before transfer.

Repay debt while keeping the facility open:

```ts
await credit.repay({
  amount: "max",
  from: "credit_account",
});
```

`amount: "max"` pays the current debt within freshly authorized funding bounds.
`from: "credit_account"` uses controlled settlement cash. `from: "wallet"` uses
the connected Monad wallet; `from: "aurora_intents"` requires `source` with the
source `chain_id`, `asset`, `max_amount_in`, `source_refund_recipient`, and
`monad_refund_recipient`. The modal reviews and binds the quote, payment cap,
deadline, partial-receipt rules,
and operation before source funding. These fields follow the routing rules above.

`repay()` returns the confirmed accounting result with an `applied`, `partial`,
or `refunded` outcome, the applied amount, remaining debt, and any refund or pending
amounts. A pending transfer or settlement error carries the operation identifier
so the same receipt can be resumed. A partial payment never reports the requested
target as fully paid. Repayment does not terminate the facility. The modal shows
the resulting capacity under the revolving or non-revolving terms.

End the facility through one coordinated operation:

```ts
await credit.close();
```

`close()` reviews the unwind or supported retention path and handles pending
orders, settlement, repayment, surplus payout, and source-collateral return.
No preceding `repay()` or position-close call is required. The modal requests an
approved repayment source for any shortfall and reports blocked steps. Closing
a position alone returns its proceeds to the account; it repays debt only when
a separate repayment or valid automatic repayment instruction is executed.

### Other account operations

Source collateral can be added or safely withdrawn without ending the facility:

```ts
await credit.collateral.add({ amount });
```

```ts
await credit.collateral.withdraw({ amount });
```

These operations use the configured source-chain approvals, reservation, finality,
and proof rules. Source collateral top-up is distinct from adding application
margin. A close handles the final collateral return internally.

### Completion and recovery

| Method                             | Completion boundary                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `intent.accept()`                  | Returns the Credit after bond settlement, verified collateral binding, account readiness, and conversion to the facility commitment.         |
| `credit.app.execute()`             | Returns a confirmed terminal action result. `settled`, `cancelled`, `expired`, and `failed` remain distinct outcomes.                        |
| `credit.repay()`                   | Actual HouseVault allocation is confirmed, or a partial/refund result reports the outstanding amounts. Inbox receipt alone is not repayment. |
| `credit.account.withdraw()`        | Authorized funds reach the fixed Monad recipient.                                                                                            |
| `credit.collateral.add()`          | Finalized source deposit is verified and bound on Monad.                                                                                     |
| `credit.collateral.withdraw()`     | The authorized source withdrawal and its confirmation are reconciled.                                                                        |
| `credit.close()`                   | Authorized unwind or retention, repayment, facility termination, surplus payout, and source-collateral return are complete.                  |
| `house.account(address).deposit()` | Atomic HouseVault deposit and share mint are confirmed, or a refund result is reported. Pending inbox funds create no shares.                |

Operations return their resource or confirmed result, not a generic flow handle.
Validation or submission errors carry the known operation identifiers and status.
An execution result must be checked before the UI presents a trade as successful.
A cancelled or expired remainder may still have partial fills, which remain
reported as positions and liabilities.

The modal records Intent, Credit, action, and transaction identifiers as soon as
they exist. Dismissal, disconnection, timeout, or a rejected wallet prompt does
not undo confirmed transactions. Reopening resolves recorded state and resumes
required steps. Retrying a pending setup or closure continues that operation.
A new trade requires a new authorization and nonce. Aborted or expired setup
settles the bond and releases its reservation. Collateral returns continue through
the configured path, including finalized locks proved after abort. An aborted
setup with an outstanding return remains visible until that return is confirmed.

No UI promise can make asynchronous settlement atomic. A blocked external exit
remains pending or enters recovery under the accepted policy. The modal reports
repayment shortfalls, maturity, liquidation, and remaining losses separately.

### Optional reads and House methods

These methods support dashboards and custom interfaces. They are not required
steps in the borrower lifecycle.

| Resource                 | Methods                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `termbook.credit(id)`    | `summary()`, `activity()`, `subscribe(callback)`                                                                                                     |
| `credit.account`         | `summary()`, `balances()`, `health()`                                                                                                                |
| `credit.collateral`      | `balance()`                                                                                                                                          |
| `credit.app`             | `capabilities()`, `positions()`, `pending()`                                                                                                         |
| `termbook.house(id)`     | `summary()`, `activity()`, `integrations()`, `subscribe(callback)`                                                                                   |
| `house.account(address)` | `summary()`, `deposit({ amount, source? })`, `withdraw({ amount, to })`, `withdrawals()`, `claim(withdrawal_id)`, `cancel_withdrawal(withdrawal_id)` |
| `termbook.catalog`       | `chains(filters)`, `assets(filters)`, `houses(filters)`, `integrations(filters)`                                                                     |

A subscription returns a cleanup function for UI teardown. Stopping it changes
no protocol state. House LP queue claims are separate from borrower facility
closure. For `deposit()`, omitting `source` means a direct Monad deposit;
`source` may select `provider: "aurora_intents"` and supplies `chain_id`, `asset`,
`max_amount_in`, `source_refund_recipient`, and `monad_refund_recipient`. `amount`
denotes the requested net House settlement-asset amount in either mode. The review binds the
actual amount bounds, share recipient, `min_shares`, and `deposit_deadline` before
funding. The result distinguishes minted shares, pending settlement, and refunds.
Changing deposit bounds requires a new LP authorization. Resource addresses select
records; mutations require the proper signer.

### Errors

Errors identify offer validity, liquidity, proof, permission, capability,
parameter, recipient, nonce, authorization freshness, draw limit, health,
settlement, recovery, or release failures. Each includes a public code, readable
reason, known identifiers, and safe next action. Retry behavior checks recorded
state before any new submission.
