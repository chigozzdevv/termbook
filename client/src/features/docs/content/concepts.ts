import { page, section, p, code, table, list, note, flow } from "../model";

export const conceptPages = [
  page("concepts/credit", "Concepts", "The credit lifecycle", "A facility reserves capacity. A draw creates debt and executes an approved action.", [
    section("setup", "Set up a facility",
      flow([{ title: "Request", text: "Collateral, limit and duration" }, { title: "Accept", text: "Signed House terms" }, { title: "Prove", text: "Verify the collateral lock" }, { title: "Ready", text: "Bind the Credit Account" }]),
      list(["The app submits a credit request and receives House offers.", "The borrower accepts an offer, including rates, deadlines, a reservation bond and recovery rules.", "The source wallet locks collateral into the admitted vault or program.", "A proof binds that lock to the facility on Monad. The Credit Account becomes ready."], true),
      p("Acceptance reserves House liquidity; it is not a transfer of the full credit limit. Unused setup can expire or be aborted under the accepted bond and collateral-return rules.")),
    section("draw", "Draw & execute",
      p("A draw transfers the amount needed for the approved action from the House to the Credit Account. Core executes the bounded calls, verifies the result and checks post-action health. For atomic actions, a failing check reverts the transaction."),
      p("A ready facility can support further draws without repeating the original collateral lock. Capacity still depends on debt, House liquidity, accepted terms, maturity and current health. Revolving and non-revolving offers differ in whether repayment restores draw capacity.")),
    section("manage", "Manage & terminate",
      table(["Operation", "Effect"], [
        ["Sell or close a position", "Moves app proceeds back under Credit Account control."],
        ["Repay", "Allocates the House’s settlement token to debt. The facility can remain open."],
        ["Withdraw", "Pays an authorized recipient after profit, obligation and health checks."],
        ["Close", "Coordinates exit, repayment, surplus payout, account release and collateral return."],
        ["Recover", "Allows an authorized keeper to unwind obligations and collect value after default or liquidation."],
      ]),
      note("Proceeds are not automatic repayment", "Selling a token does not repay the House unless a repayment instruction or closure flow applies those proceeds. A completed app exit also does not mean the facility is closed.")),
  ]),
  page("concepts/accounts", "Concepts", "Custody & permissions", "The Credit Account controls app funds while the source vault controls collateral.", [
    section("custody", "Who holds the assets?",
      table(["Asset", "Custody"], [
        ["Locked collateral", "The admitted source-chain vault or Solana program; release requires protocol authorization."],
        ["Borrowed USDC", "The Credit Account on Monad; it can fund only approved calls."],
        ["Purchased tokens", "The Credit Account, or an admitted venue position controlled by that account."],
        ["House liquidity", "HouseVault, subject to LP accounting and committed credit."],
      ]),
      p("A developer’s account.read response describes custody. Termbook independently checks balances, ownership and obligations through shared assessment components. Naming the account as controlled_by is not sufficient proof.")),
    section("authorization", "Authorize an action",
      p("Borrower authorizations bind the Credit, integration version, action, amount limits, recipients, deadlines, revision and nonce. An app token selects the admitted integration; it cannot sign for a borrower or bypass risk checks."),
      p("An execution plan declares exact call targets, calldata, native value, token spending and minimum receipts. Recipient-sensitive arguments must resolve to the bound Credit Account. Arbitrary transfers or approvals are outside the admitted plan.")),
    section("keepers", "Keepers & closure",
      p("Anyone can relay a valid collateral proof. Recovery execution requires the approved recovery-keeper role and remains constrained by registered recovery calls, price bounds and result verification. The keeper does not take custody into its own wallet."),
      p("Once safe closure releases the Credit Account, the borrower controls it. Core cannot continue executing through the released account. Cross-chain collateral return must still be confirmed before the SDK reports full closure.")),
  ]),
  page("concepts/health", "Concepts", "Health & borrowing", "Credit depends on what the protocol can recover after costs and risk adjustments.", [
    section("calculation", "Recovery health",
      code("Recovery model", `app_value = retained_factor × max(app_net_value, 0)
          + min(app_net_value, 0)

recovery_value = free_settlement_cash
               + source_value × source_retained_factor
               + app_value

recovery_health = recovery_value / (debt + recovery_costs)`, "text"),
      p("App net value includes verified recoverable assets after liabilities and applicable deductions. Negative app equity is deducted in full. Cash, positions and pending obligations must be reconciled without counting the same asset twice. A 20% haircut means a retained factor of 0.8."),
      p("For example, $100 of source collateral plus $200 of app assets at 80% retained value gives $240 of backing. With $200 debt and $10 recovery costs, health is about 1.14. Whether a draw is allowed depends on the accepted initial threshold; these numbers are an explanation, not an offer.")),
    section("thresholds", "Thresholds",
      table(["Threshold", "Use"], [
        ["Initial", "New draws and actions that increase risk."],
        ["Maintenance", "Ongoing facility permissions and withdrawal checks."],
        ["Liquidation", "Recovery trigger; accepted House thresholds must respect the protocol floor."],
      ]),
      p("At health 1, stressed recovery value only equals debt plus recovery costs. First-loss reserves do not justify unsafe accounting. Zero debt has no meaningful health ratio, but pending obligations and exit checks still apply.")),
    section("valuation", "Independently verified value",
      p("Shared readers check approved assets, prices, code identities, quantities, venue ownership, order exposure and exit liquidity. The app’s displayed balance or unrealized PnL is not automatically borrowable value."),
      list(["Stale or unavailable prices cannot support a new risk increase.", "A token balance without a viable sale path can have little recoverable value.", "Open orders reserve funds and may create future exposure.", "Risk-reducing exits use their own bounded loss and execution-price rules."]),
      note("Unknown positions", "An integration that cannot independently describe and recover its positions cannot use those positions as loan backing. The standard TypeScript interface does not bypass this requirement.")),
  ]),
  page("concepts/settlement", "Concepts", "Collateral & settlement", "Proving a lock and moving repayment value are separate operations.", [
    section("lock", "Lock & prove collateral",
      p("The collateral wallet signs on the asset’s chain. Tokens stay in that chain’s custody vault; SOL stays in the native program. The Monad facility recognizes a verified lock bound to the borrower, source owner, amount, asset and accepted terms."),
      p("Current remote collateral paths use Wormhole Guardian attestations under admitted chain and finality policies. Relayers carry the attestation; they cannot manufacture a valid Guardian quorum. Testnet Ethereum can use an explicitly configured faster confirmation policy. Mainnet risk policy must be admitted separately.")),
    section("return", "Return & seize",
      p("Monad authorizes a return or recovery action. The source-side verifier checks that authorization before releasing or seizing collateral. A release transfers to the bound source recipient. A seizure starts the approved recovery path; it is not a keeper’s unrestricted withdrawal.")),
    section("value-routing", "Aurora value routing",
      table(["Use", "Result on Monad"], [
        ["Remote repayment", "A borrower’s source payment arrives as the House’s settlement token."],
        ["Remote LP deposit", "Delivered settlement tokens fund a House deposit and share mint."],
        ["Converted collateral recovery", "Proceeds from a seized asset repay or recover the House’s debt."],
      ]),
      p("Routes bind the source asset, maximum input, destination token, recipient, deadline and refund rules. Funds reaching an inbox are not yet repayment: the protocol must confirm their actual accounting allocation."),
      note("Testnet routes", "The configured Aurora provider currently exposes no matching Sepolia, Solana devnet or Monad testnet routes. Local repayment and deposits work directly on Monad. Remote conversion tests need provider-supported routes.")),
    section("pending", "Pending, partial & refunded",
      p("Source confirmations, destination receipts and final accounting can complete at different times. Preserve the operation checkpoint. Partial receipts repay only the applied amount; shortfalls remain visible. Expired or invalid settlement follows the bound refund path.")),
  ]),
  page("concepts/recovery", "Concepts", "Maturity & recovery", "Exit and repayment must work even when the borrower stops cooperating.", [
    section("maturity", "At maturity",
      p("Undrawn commitments end and new risk stops. Outstanding debt becomes due under the accepted grace and default terms. Maturity is a lending deadline, not the blockchain confirmation time for a transaction.")),
    section("recovery", "Recovery sequence",
      list(["Freeze risk increases and reconcile pending fills or cancellations.", "Cancel remaining orders and settle venue obligations.", "Withdraw or redeem recoverable positions into the Credit Account.", "Convert approved holdings to the House’s settlement asset with bounded price protection.", "Apply actual proceeds to debt, then determine whether source collateral recovery is needed.", "Verify remaining obligations and safe release before returning surplus or collateral."], true),
      p("Some apps have withdrawal queues or cancellation delays. Their exit callback returns wait with an identifier and retry time. Recovery remains resumable; it cannot report done while obligations are unresolved.")),
    section("losses", "Shortfalls & losses",
      p("Recovery cannot guarantee liquidity or a sale price. Insufficient proceeds remain a debt shortfall until the accepted recovery policy resolves them. House losses affect its accounting and LP share value. The UI must distinguish recovered amounts, outstanding debt and final losses."),
      note("A testable requirement", "Admission tests run recovery using a separate keeper wallet without a new borrower authorization. A happy-path buy and sell alone cannot establish recoverability.")),
  ]),
];
