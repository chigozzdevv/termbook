import { page, section, p, code, table, note } from "../model";

export const actionExamples = {
  spot: [
    { capability: "place_order", params: { market_id: "MON-USDC", direction: "buy", order_type: "market", amount: { spend: 100_000n }, slippage_bps: 50 } },
    { capability: "place_order", params: { market_id: "MON-USDC", direction: "sell", order_type: "market", amount: { spend: 100_000_000_000_000_000n }, slippage_bps: 50 } },
    { capability: "place_order", params: { market_id: "MON-USDC", direction: "buy", order_type: "limit", amount: { receive: 100_000_000_000_000_000n }, limit_price: 2_000_000n, expires_at: 1_900_000_000 } },
    { capability: "modify_order", params: { order_id: "42", market_id: "MON-USDC", direction: "buy", amount: { spend: 100_000n }, limit_price: 2_000_000n, expires_at: 1_900_000_000 } },
    { capability: "cancel_order", params: { order_id: "42" } },
  ],
  perps: [
    { capability: "place_order", params: { market_id: "ETH-USDC", direction: "long", order_type: "market", amount: { margin: 100_000_000n, notional: 200_000_000n }, slippage_bps: 50 } },
    { capability: "increase_position", params: { position_id: "17", amount: { margin: 10_000_000n, notional: 20_000_000n }, slippage_bps: 50 } },
    { capability: "decrease_position", params: { position_id: "17", amount: { notional: 20_000_000n }, slippage_bps: 50 } },
    { capability: "add_margin", params: { position_id: "17", amount: 10_000_000n } },
    { capability: "remove_margin", params: { position_id: "17", amount: 5_000_000n } },
    { capability: "cancel_order", params: { order_id: "42" } },
    { capability: "close_position", params: { position_id: "17", slippage_bps: 50 } },
  ],
  vault: [
    { capability: "deposit_vault", params: { market_id: "USDC-VAULT", amount_in: 10_000_000n, min_shares: 9_900_000n } },
    { capability: "redeem_vault", params: { position_id: "3", shares_in: 5_000_000n, min_amount_out: 4_950_000n } },
    { capability: "claim_rewards", params: { position_id: "3" } },
    { capability: "withdraw_to_credit_account", params: { request_id: "9" } },
  ],
  staking: [
    { capability: "stake", params: { market_id: "MON-STAKING", amount_in: 1_000_000_000_000_000_000n, min_receipt_out: 990_000_000_000_000_000n } },
    { capability: "claim_rewards", params: { position_id: "7" } },
    { capability: "request_unstake", params: { position_id: "7", amount: 500_000_000_000_000_000n } },
    { capability: "complete_unstake", params: { request_id: "12" } },
    { capability: "withdraw_to_credit_account", params: { position_id: "7", amount: 500_000_000_000_000_000n } },
  ],
  liquidity: [
    { capability: "add_liquidity", params: { market_id: "MON-USDC-LP", amounts_in: [{ asset_id: "MON", amount_in: 1_000_000_000_000_000_000n }, { asset_id: "USDC", amount_in: 2_000_000n }], min_liquidity_out: 1_000n } },
    { capability: "remove_liquidity", params: { position_id: "15", liquidity_in: 500n, min_amounts_out: [{ asset_id: "MON", min_amount_out: 490_000_000_000_000_000n }, { asset_id: "USDC", min_amount_out: 980_000n }] } },
    { capability: "stake_lp", params: { position_id: "15", amount: 1_000n } },
    { capability: "unstake_lp", params: { position_id: "15", amount: 1_000n } },
    { capability: "claim_rewards", params: { position_id: "15" } },
    { capability: "collect_fees", params: { position_id: "15" } },
  ],
};

export function actionCode(use_case: keyof typeof actionExamples, index = 0): string {
  const action = { use_case, ...actionExamples[use_case][index] };
  const value = JSON.stringify(action, (_, item) => typeof item === "bigint" ? `${item}n` : item, 2)
    .replace(/"(\d+)n"/g, "$1n")
    .replace(/"expires_at": 1900000000/g, '"expires_at": Math.floor(Date.now() / 1000) + 3600');
  return `termbook.open({\n  action: ${value.replace(/\n/g, "\n  ")},\n});`;
}

const shared = p("Every account snapshot includes block, holdings and liabilities. Use actual venue data, with owners bound to the Credit Account. Optional public actions must be declared in the definition; a schema-supported capability does not mean every integration offers it.");
const status = note("Interface support", "These are implemented SDK and shared assessment shapes. The bundled live trading integration is Kuru spot. An app in another use case still needs its own implementation, admitted definition and lifecycle validation.");

export const useCasePages = [
  page("integrations/spot", "Use cases", "Spot", "Buy and sell actual assets using swaps or an orderbook.", [
    section("shape", "Return shape", shared,
      code("PluginStates[\"spot\"]", `{
  block: context.block,
  holdings: [
    { holding_id: "usdc", asset: usdc, amount: 100_000n,
      held_at: context.account, controlled_by: context.account,
      withdrawable_now: 100_000n },
  ],
  liabilities: [],
  orders: [],
}`),
      p("Orders are present for resting orders, partial fills and cancellation requests. An atomic-only adapter can return an empty array when it proves no venue obligation remains. Purchased tokens are spot holdings, not perpetual positions.")),
    section("capabilities", "Capabilities",
      table(["Capability", "Parameters", "Result"], [
        ["place_order · market", "market_id, direction, order_type, amount, slippage_bps", "Execute a protected buy or sell."],
        ["place_order · limit", "market_id, direction, order_type, amount, limit_price, expires_at", "Place an order bounded by price and expiry."],
        ["modify_order", "order_id, market_id, direction, amount, limit_price, expires_at", "Modify an existing limit order."],
        ["cancel_order", "order_id", "Request cancellation; final fills and refunds still need reconciliation."],
      ]),
      p("direction is buy or sell. amount has exactly one of spend or receive, independently of market or limit. spend fixes input and requires output protection; receive fixes output and requires an input cap. An integration may support only selected combinations.")),
    section("buy-sell", "Buy & sell",
      code("Buy · 0.1 USDC", actionCode("spot", 0)),
      code("Sell · 0.1 MON", actionCode("spot", 1)),
      p("Market IDs in these generic examples are illustrative. For Kuru use its registered address-based market ID. A buy can draw settlement credit; a sell spends owned tokens and returns proceeds to the account. Repayment remains a separate operation.")),
    section("limits", "Limit orders",
      code("Buy · receive a fixed amount", actionCode("spot", 2)),
      p("Read limit_price using the registered integration’s declared scale. Integrations with native expiry require expires_at in Unix seconds. A venue without enforced expiry declares expiry: none and rejects expires_at. Kuru prices use 18 decimals; its orders remain open until filled or cancelled.")),
    section("exit", "Exit requirements", p("Cancel pending orders, reconcile fills, withdraw any venue-held assets and sell remaining admitted holdings through protected routes. Shared assessment must account for committed funds and sale depth."), status),
  ]),
  page("integrations/perps", "Use cases", "Perps", "Manage margin and notional exposure with independently verifiable positions.", [
    section("shape", "Return shape", shared,
      code("PluginStates[\"perps\"]", `{
  block: context.block,
  holdings: [], liabilities: [], orders: [],
  positions: [{
    position_id: "17", market_id: "ETH-USDC", owner: context.account,
    assets: [{ asset: usdc, amount: 100_000_000n }],
    liability: 0n, recoverable_value: 95_000_000n,
    direction: "long", margin: 100_000_000n,
    notional: 200_000_000n, unrealized_pnl: -5_000_000n,
  }],
}`),
      p("PnL is signed. Recoverable value is nonnegative and must not exceed the independent close-and-withdraw valuation. Margin, notional, funding and venue liabilities use the registered market’s declared scales.")),
    section("capabilities", "Capabilities",
      table(["Capability", "Parameters", "Purpose"], [
        ["place_order", "market_id, direction, order_type, amount: { margin, notional }, slippage_bps OR limit_price + expires_at", "Open long or short exposure."],
        ["increase_position", "position_id, amount: { margin, notional }, slippage_bps", "Increase trading exposure."],
        ["decrease_position", "position_id, amount: { notional }, slippage_bps", "Reduce exposure."],
        ["add_margin / remove_margin", "position_id, amount", "Change margin without changing the requested notional."],
        ["cancel_order", "order_id", "Cancel a pending order."],
        ["close_position", "position_id, slippage_bps", "Close the remaining position."],
      ])),
    section("example", "Open a position", code("place_order", actionCode("perps")),
      p("direction is long or short. place_order and close_position builders are mandatory for the perps type. Exposure and margin must pass both venue checks and Termbook’s independent health policy.")),
    section("exit", "Exit requirements", p("Cancel orders, settle partial fills, close exposure and withdraw collateral proceeds. Liquidation fees, funding, outstanding obligations and market-close liquidity must be deducted from recoverable value. A borrower-only close interface cannot satisfy keeper recovery."), status),
  ]),
  page("integrations/vault", "Use cases", "Vaults", "Deposit into a strategy and recover its underlying assets through a verified redemption path.", [
    section("shape", "Return shape", shared,
      code("PluginStates[\"vault\"]", `{
  block: context.block, holdings: [], liabilities: [],
  positions: [{
    position_id: "3", market_id: "USDC-VAULT", owner: context.account,
    assets: [{ asset: usdc, amount: 10_000_000n }],
    liability: 0n, recoverable_value: 9_900_000n, shares: 10_000_000n,
  }],
  requests: [],
}`),
      p("Share ownership and the actual redemption value must be readable at the snapshot block. A share’s accounting price is not sufficient when exit fees, losses or a queue change recoverability.")),
    section("capabilities", "Capabilities",
      table(["Capability", "Parameters", "Purpose"], [
        ["deposit_vault", "market_id, amount_in, min_shares", "Deposit underlying and enforce minimum minted shares."],
        ["redeem_vault", "position_id, shares_in, min_amount_out", "Redeem shares with a minimum underlying receipt."],
        ["claim_rewards", "position_id", "Collect admitted rewards into the account."],
        ["withdraw_to_credit_account", "request_id", "Complete an existing redemption request."],
      ])),
    section("example", "Deposit", code("deposit_vault", actionCode("vault"))),
    section("exit", "Exit requirements", p("Redeem shares, track delayed requests, claim when available and convert the underlying into settlement assets if needed. requests include claimable_at and may reference replaces_position_id to prevent counting shares and the withdrawal claim twice."), status),
  ]),
  page("integrations/staking", "Use cases", "Staking", "Track stake, rewards and unstaking obligations through completion.", [
    section("shape", "Return shape", shared,
      code("PluginStates[\"staking\"]", `{
  block: context.block, holdings: [], liabilities: [],
  positions: [{
    position_id: "7", market_id: "MON-STAKING", owner: context.account,
    assets: [{ asset: native_mon, amount: 1_000_000_000_000_000_000n }],
    liability: 0n, recoverable_value: 900_000n,
    staked: 1_000_000_000_000_000_000n, rewards: 0n,
  }],
  requests: [],
}`),
      p("Staked quantities use asset units; recoverable_value and liability use settlement valuation units. Account for slashing risk, withdrawal delays and admitted reward assets.")),
    section("capabilities", "Capabilities",
      table(["Capability", "Parameters", "Purpose"], [
        ["stake", "market_id, amount_in, optional min_receipt_out", "Stake assets with applicable receipt protection."],
        ["claim_rewards", "position_id", "Claim rewards."],
        ["request_unstake", "position_id, amount", "Create an unstaking request."],
        ["complete_unstake", "request_id", "Complete a claimable request."],
        ["withdraw_to_credit_account", "position_id, amount", "Withdraw through an admitted account-controlled path."],
      ])),
    section("example", "Stake", code("stake", actionCode("staking"))),
    section("exit", "Exit requirements", p("Request unstaking once, wait for the claim time, complete the request and collect recoverable rewards. Recovery must function without the borrower and retain the request identity across retries."), status),
  ]),
  page("integrations/liquidity", "Use cases", "Liquidity", "Control LP tokens or position NFTs and recover their underlying assets.", [
    section("shape", "Return shape", shared,
      code("PluginStates[\"liquidity\"]", `{
  block: context.block, holdings: [], liabilities: [],
  positions: [{
    position_id: "15", market_id: "MON-USDC-LP", owner: context.account,
    assets: [
      { asset: native_mon, amount: 1_000_000_000_000_000_000n },
      { asset: usdc, amount: 2_000_000n },
    ],
    liability: 0n, recoverable_value: 3_800_000n,
    liquidity: 1_000n, rewards: [],
  }],
}`),
      p("For position NFTs, verify account ownership and any staking custody. Underlying asset amounts, fees and rewards must be recoverable under the admitted exit rules.")),
    section("capabilities", "Capabilities",
      table(["Capability", "Parameters", "Purpose"], [
        ["add_liquidity", "market_id, amounts_in: [{ asset_id, amount_in }], min_liquidity_out, optional tick_lower + tick_upper", "Add protected liquidity."],
        ["remove_liquidity", "position_id, liquidity_in, min_amounts_out: [{ asset_id, min_amount_out }]", "Remove with minimum underlying receipts."],
        ["stake_lp / unstake_lp", "position_id, optional amount", "Move the LP position through approved staking custody."],
        ["claim_rewards / collect_fees", "position_id", "Collect approved assets into the account."],
      ]),
      p("Asset IDs must be unique. Concentrated-liquidity ticks must be supplied together and tick_lower must be less than tick_upper.")),
    section("example", "Add liquidity", code("add_liquidity", actionCode("liquidity"))),
    section("exit", "Exit requirements", p("Unstake if necessary, remove liquidity, collect fees and rewards, then convert holdings into the settlement asset. The reader must value the actual underlying inventory and exclude inaccessible or unpriced rewards."), status),
  ]),
];
