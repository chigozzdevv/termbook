import { page, section, p, code, table, links, flow, note } from "../model";

export const startPages = [
  page("", "Getting started", "Build with Termbook", "Credit inside Monad applications, backed by source collateral and recoverable app assets.", [
    section("how-it-works", "How it works",
      p("A borrower locks collateral, accepts a House offer and receives a Credit Account. Borrowed USDC enters that account and funds approved app actions. Assets and positions remain under the account’s control until repayment and closure."),
      flow([{ title: "Lock", text: "ETH, SOL or MON collateral" }, { title: "Borrow", text: "USDC from a House" }, { title: "Use", text: "An approved app action" }, { title: "Close", text: "Repay and return collateral" }]),
      p("Credit can exceed the value of source collateral when the app assets provide enough conservatively recoverable backing. Each draw must pass the House’s limits and the post-action health check.")),
    section("choose-your-path", "Choose your path",
      links([
        { href: "/docs/integrations/overview", title: "Integrate an app", description: "Implement a standard interface, validate its lifecycle and register a version." },
        { href: "/docs/sdk/quickstart", title: "Embed the modal", description: "Pass an app token, a connected wallet and an optional action." },
        { href: "/docs/houses/overview", title: "Run or fund a House", description: "Set lending policies or supply settlement-asset liquidity." },
        { href: "/docs/operators/local", title: "Run locally", description: "Start persistence, the API, indexers and keepers." },
      ])),
    section("participants", "Participants",
      table(["Role", "Responsibility"], [
        ["Borrower", "Accepts terms, locks collateral and authorizes account actions."],
        ["Application", "Builds approved actions and describes its holdings, obligations and exit path."],
        ["House", "Provides credit, chooses risk limits and bears its allocated lending losses."],
        ["LP", "Supplies the House’s settlement asset and holds shares in its net assets."],
        ["Keeper", "Relays proofs or executes authorized recovery and settlement steps."],
        ["Governance", "Admits integrations and configures or upgrades protocol components."],
      ])),
    section("first-action", "Your first action",
      code("app.ts", `import { create_termbook } from "@termbook/sdk";
import { wallet } from "./wallet";

const termbook = create_termbook({
  app_token: process.env.NEXT_PUBLIC_TERMBOOK_APP_TOKEN!,
  wallet,
});

const modal = termbook.open({
  action: {
    use_case: "spot",
    capability: "place_order",
    params: {
      market_id: "0x1f57a841540fe23c2989387c18f2cb1335cbae92",
      direction: "buy",
      order_type: "market",
      amount: { spend: 100_000n },
      slippage_bps: 50,
    },
  },
});

await modal.ready;`),
      p("This example requests a 0.1 USDC spend with 0.5% slippage on the testnet Kuru market. The modal lets the borrower review the offer, connect the collateral wallet and approve each required signature. Opening it does not automatically borrow.")),
  ]),
  page("getting-started/networks", "Getting started", "Networks & assets", "Choose the lending network and a supported collateral market.", [
    section("networks", "Networks",
      table(["Network", "Identifier", "Role"], [
        ["Monad testnet", "10143", "Credit Accounts, Houses, app execution and USDC settlement."],
        ["Ethereum Sepolia", "11155111", "WETH collateral vault."],
        ["Solana devnet", "Solana genesis identity", "Native SOL collateral program."],
      ]),
      note("Testnet deployment", "The current deployment is a test environment. Mainnet deployment and provider routes require their own admission and configuration. Testnet assets have no production value.")),
    section("collateral", "Collateral assets",
      table(["Asset", "Where it stays", "Wallet used to lock"], [
        ["MON", "Native collateral vault on Monad.", "Monad EVM wallet."],
        ["ETH exposure through WETH", "WETH vault on Ethereum; the token is not bridged to Monad.", "Ethereum EVM wallet."],
        ["SOL", "Native SOL custody account owned by the Solana program.", "Solana wallet."],
      ]),
      p("Only admitted markets with configured custody, pricing, proof and recovery policies can back a facility. An ERC-20 interface alone does not make a token eligible.")),
    section("units", "Amounts & identifiers",
      p("Amounts use each asset’s smallest unit. USDC has 6 decimals, MON and WETH have 18, and SOL has 9 lamports decimals. Use bigint in TypeScript and decimal strings in JSON. Never send a floating-point token amount."),
      code("units.ts", `import { parseUnits } from "viem";

const usdc = parseUnits("0.1", 6);       // 100_000n
const weth = parseUnits("0.01", 18);    // 10_000_000_000_000_000n
const sol = 100_000_000n;                // 0.1 SOL
const native_asset = "0x0000000000000000000000000000000000000000";`),
      p("The zero EVM address represents a native asset in EVM action plans. Solana public keys remain base58 identities in source-wallet operations. The SDK’s Solana alias helpers handle the protocol binding; do not truncate a public key into an EVM address.")),
    section("addresses", "Deployment addresses",
      table(["Monad testnet component", "Address"], [
        ["Core", "0x198995faab55a9d5d4dceab56abaaa273c26fad7"],
        ["Kuru House", "0xdeace78c2cb205cec7bf2ceed7fef49ae659e011"],
        ["Circle test USDC", "0x534b2f3A21130d7a60830c2Df862319e593943A3"],
        ["Kuru MON/USDC market", "0x1F57a841540fe23C2989387c18F2CB1335CBAe92"],
      ]),
      p("The repository’s deployments/testnet.json is the complete deployment manifest. Application SDK configuration resolves through the registered app token, so frontend teams do not manually copy Core and RPC addresses into every integration.")),
  ]),
];
