import { page, section, p, code, table, links, diagram, note, type TableCell } from "../model";

const monadAddress = (name: string, address: string): TableCell => ({
  text: address,
  href: `https://testnet.monadexplorer.com/address/${address}`,
  label: `${name}: ${address} on Monad testnet explorer`,
});

export const openExample = `import { create_termbook, evm_wallet } from "@termbook/sdk";
import type { WalletClient } from "viem";

export async function open_credit(wallet_client: WalletClient) {
  const termbook = create_termbook({
    app_token: process.env.NEXT_PUBLIC_TERMBOOK_APP_TOKEN!,
    wallet: await evm_wallet(wallet_client),
  });

  const modal = termbook.open({
    action: {
      use_case: "spot",
      capability: "place_order",
      params: {
        market_id: "0x1f57a841540fe23c2989387c18f2cb1335cbae92",
        direction: "buy",
        order_type: "market",
        amount: { spend: 10_000n },
        slippage_bps: 50,
      },
    },
  });

  await modal.ready;
  return modal;
}`;

export const startPages = [
  page("", "Getting started", "Build with Termbook", "Credit inside Monad applications, backed by source collateral and recoverable app assets.", [
    section("how-it-works", "How it works",
      p("A borrower accepts a House offer, locks collateral and activates a facility. A draw sends USDC from the House to the Credit Account and executes an approved app action. Purchased assets and positions remain under that account’s control until repayment and closure."),
      diagram("From credit to an app action", "Accept terms and prove collateral once. A ready facility can fund approved actions, then close through exit, repayment and collateral return.", `flowchart LR
  A[Accept, lock and prove] --> B[Draw and use app]
  B --> C[Exit, repay and return]`),
      p("Credit can exceed source collateral value when verified app assets provide enough recoverable backing. Each draw must pass the House’s limits and the post-action health check."),
      links([{ href: "/docs/concepts/credit", title: "Understand the credit lifecycle", description: "See what acceptance, a draw, repayment and closure each do." }])),
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
      p("The SDK supplies evm_wallet to adapt your app’s connected viem WalletClient. Pass that client to open_credit. The modal connects the collateral wallet during setup."),
      code("app.ts · call from a browser click handler", openExample),
      p("This requests a 0.01 USDC spend with 0.5% slippage on the testnet Kuru market. The borrower reviews the offer and approves each required signature. Opening the modal does not automatically borrow."),
      links([{ href: "/docs/sdk/quickstart#wallet", title: "Wallet connection & complete setup", description: "Use an existing app wallet or connect a browser wallet, then open the modal." }])),
  ]),
  page("getting-started/networks", "Getting started", "Networks & assets", "Choose the lending network and a supported collateral market.", [
    section("networks", "Networks",
      table(["Network", "Identifier", "Role"], [
        ["Monad testnet", "10143", "Credit Accounts, Houses, app execution and USDC settlement."],
        ["Ethereum Sepolia", "11155111", "WETH collateral vault."],
        ["Base Sepolia", "84532", "WETH collateral vault."],
        ["Solana devnet", "Solana genesis identity", "Native SOL collateral program."],
      ]),
      note("Testnet deployment", "The current deployment is a test environment. Mainnet deployment and provider routes require their own admission and configuration. Testnet assets have no production value.")),
    section("collateral", "Collateral assets",
      table(["Asset", "Where it stays", "Wallet used to lock"], [
        ["MON", "Native collateral vault on Monad.", "Monad EVM wallet."],
        ["ETH exposure through WETH", "WETH vault on Ethereum Sepolia or Base Sepolia; the collateral stays on its source chain.", "EVM wallet on the selected source network."],
        ["SOL", "Native SOL custody account owned by the Solana program.", "Solana wallet."],
      ]),
      p("Only admitted markets with configured custody, pricing, proof and recovery policies can back a facility. An ERC-20 interface alone does not make a token eligible.")),
    section("units", "Amounts & identifiers",
      p("Amounts use each asset’s smallest unit. USDC has 6 decimals, MON and WETH have 18, and 1 SOL equals 1,000,000,000 lamports. Use bigint in TypeScript and decimal strings in JSON. Never send a floating-point token amount."),
      code("units.ts", `import { parseUnits } from "viem";

const usdc = parseUnits("0.1", 6);       // 100_000n
const weth = parseUnits("0.01", 18);    // 10_000_000_000_000_000n
const sol = 100_000_000n;                // 0.1 SOL
const native_asset = "0x0000000000000000000000000000000000000000";`),
      p("The zero EVM address represents a native asset in EVM action plans. Solana public keys remain base58 identities in source-wallet operations. The SDK’s Solana alias helpers handle the protocol binding; do not truncate a public key into an EVM address.")),
    section("addresses", "Deployment addresses",
      table(["Monad testnet component", "Address"], [
        ["Core", monadAddress("Core", "0x198995faab55a9d5d4dceab56abaaa273c26fad7")],
        ["Kuru House", monadAddress("Kuru House", "0xdeace78c2cb205cec7bf2ceed7fef49ae659e011")],
        ["Circle test USDC", monadAddress("Circle test USDC", "0x534b2f3A21130d7a60830c2Df862319e593943A3")],
        ["Kuru MON/USDC market", monadAddress("Kuru MON/USDC market", "0x1F57a841540fe23C2989387c18F2CB1335CBAe92")],
      ]),
      p("The repository’s deployments/testnet.json is the complete deployment manifest. Application SDK configuration resolves through the registered app token, so frontend teams do not manually copy Core and RPC addresses into every integration.")),
  ]),
];
