import { page, section, p, code, table, list, note, links } from "../model";
import { openExample } from "./start";

export const sdkPages = [
  page("sdk/quickstart", "Borrower SDK", "Embed the modal", "Configure the SDK once, then open it with a standard action.", [
    section("install", "Use the workspace package",
      code("Workspace dependency", `{
  "dependencies": {
    "@termbook/sdk": "workspace:^",
    "viem": "^2.56.3"
  }
}`, "json"),
      p("The current repository provides @termbook/sdk as a workspace package. Build the workspace before importing its compiled entry point. These instructions do not assume a published npm release."),
      code("From the repository root", `pnpm install
pnpm build`, "shell")),
    section("configure", "Configure the public API",
      p("The app token resolves chain, RPC and protocol addresses from the registered version. Set the public API origin once in your bundler so the SDK can resolve that token. For Next.js, expose only public configuration:"),
      code(".env.local", `NEXT_PUBLIC_TERMBOOK_API_URL=http://127.0.0.1:3002
NEXT_PUBLIC_TERMBOOK_APP_TOKEN=your_active_app_token`, "shell"),
      code("next.config.ts · merge with your existing config", `import type { NextConfig } from "next";

const config: NextConfig = {
  env: {
    TERMBOOK_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_TERMBOOK_API_URL,
  },
};

export default config;`),
      p("Use the hosted API origin outside local development. Private keys, database credentials and provider API keys never belong in frontend environment variables.")),
    section("wallet", "Connect an EVM wallet",
      p("Termbook supplies evm_wallet, an adapter for a connected viem WalletClient. Your app’s wallet provider connects the borrower’s Monad wallet. The adapter forwards signing and transactions to that wallet; it does not create a key or hold funds."),
      code("Use your connected app wallet", `import { evm_wallet } from "@termbook/sdk";

const wallet = await evm_wallet(wallet_client);`),
      p("wallet_client is the connected WalletClient from your app’s wallet provider. If your app does not have one, this browser example connects an injected wallet on Monad testnet. Call it from a user click handler, then pass its result to open_credit in the next section."),
      code("Browser wallet connection · optional", `import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { monadTestnet } from "viem/chains";

export async function connect_wallet() {
  const provider = (window as Window & {
    ethereum?: EIP1193Provider;
  }).ethereum;
  if (!provider) throw new Error("Install an EVM wallet to continue.");

  const client = createWalletClient({
    chain: monadTestnet,
    transport: custom(provider),
  });
  await client.requestAddresses();
  await client.switchChain({ id: monadTestnet.id });
  return client;
}`),
      table(["Wallet", "Connection & purpose"], [
        ["Monad borrower wallet", "Connected by your app; signs House terms and account actions through evm_wallet."],
        ["Collateral wallet", "Connected by the modal; locks and receives collateral on its source chain. SOL requires a Solana wallet."],
        ["Credit Account", "Created by the protocol; holds borrowed funds and app assets. It is not a browser wallet."],
      ])),
    section("open", "Open Termbook",
      code("app.ts · browser click handler", openExample),
      p("Call open_credit with the connected client. With the optional connection example, call open_credit(await connect_wallet()). Reuse the configured Termbook client for subsequent opens while the connected account is unchanged; recreate it when the borrower account changes."),
      p("open returns a TermbookModal with a ready promise. The modal owns offer review, source-wallet connection, collateral setup, execution and account management. The action must belong to the active integration version."),
      links([{ href: "/docs/sdk/modal", title: "Modal behavior & source wallets", description: "See setup, resumed facilities, wallet roles and progress states." }])),
  ]),
  page("sdk/modal", "Borrower SDK", "Modal & source wallets", "Use the same entry point for a prepared action or an existing account.", [
    section("options", "Open options",
      table(["Option", "Behavior"], [
        ["action", "Prepares a standard app action for review."],
        ["tab: account | app", "Chooses the initial modal tab."],
        ["creditId", "Opens an existing facility."],
      ]),
      code("Open account management", `const modal = termbook.open({
  creditId: credit_id,
  tab: "account",
});
await modal.ready;`),
      p("Without options, open lets the borrower choose setup or an existing facility. The Account tab exposes debt, health, collateral, repayment and closure. The App tab exposes admitted actions and current positions or pending activity.")),
    section("source", "Separate source wallets",
      p("A SOL-backed borrower connects a Monad EVM wallet for the loan and a Solana wallet for the collateral lock. These are separate identities bound by the setup. Ethereum collateral uses an EVM wallet on Sepolia or the admitted Ethereum network."),
      p("The SDK resolves the source market and connects a compatible browser wallet. sourceWalletResolver can supply an explicit SourceLockWallet for custom clients. It must sign on the source chain and preserve the bound source owner and recipient."),
      code("Optional custom resolver", `const termbook = create_termbook({
  app_token,
  wallet,
  sourceWalletResolver: async (market) => {
    return source_wallet_for(market);
  },
});`),
      note("Custom resolver", "source_wallet_for is your wallet connection function, not an SDK export. The default modal flow already connects supported browser source wallets.")),
    section("progress", "Show real progress",
      list(["Offer acceptance and reservation.", "Source approval and collateral lock.", "Required confirmations and proof acceptance.", "Account readiness and action review.", "Submitted, pending and final execution results.", "Repayment, exit steps and confirmed collateral return."]),
      p("Closing the modal does not undo confirmed transactions. Reopening resolves recorded identifiers and resumes required steps. Never show success simply because a wallet prompt was approved.")),
  ]),
  page("sdk/manage", "Borrower SDK", "Manage a Credit", "Read state, execute reviewed actions, repay and close through the resource API.", [
    section("read", "Read the facility",
      code("credit.ts", `const credit = termbook.credit(credit_id);
const summary = await credit.summary();
const health = await credit.account.health();
const positions = await credit.app.positions();
const pending = await credit.app.pending();

const unsubscribe = credit.subscribe((events) => {
  render_activity(events);
});

// Call unsubscribe when the view is removed.`),
      p("summary reports facility state, debt, limit, revision and account. health reports the current debt and risk state. Account balances reads the House settlement token; use the integration’s account reader for the complete app portfolio.")),
    section("execute", "Review & execute",
      code("Existing facility", `const review = await credit.app.review(action);
if (!review.canExecute) throw new Error(review.healthState);

const result = await credit.app.execute(action, review);
if (result.status !== "settled") {
  show_action_outcome(result);
}`),
      p("The review includes required input, spending, free assets, required draw, projected debt and projected health. Execution still checks the current authorized state; a prior review is not a guarantee of acceptance.")),
    section("repay", "Repay",
      code("Use account proceeds", `const payment = await credit.repay({
  amount: "max",
  from: "credit_account",
});

console.log(payment.status, payment.applied, payment.remaining);`),
      p("from can be credit_account, wallet or aurora_intents. Remote payments also need an admitted source route and bounded source/refund configuration. applied is the actual amount allocated; remaining is outstanding debt. Do not treat partial or pending as fully repaid.")),
    section("close", "Close the facility",
      code("Unwind and close", `await credit.close({ mode: "unwind" });`),
      p("Closure coordinates the approved app exit, repayment, surplus handling, account release and source-collateral return. No preceding sell or repay call is required. Retain mode is available only when the integration and accepted terms allow it, with debt funded through an approved source.")),
    section("collateral", "Collateral & withdrawals",
      code("Other operations", `await credit.collateral.add({ amount: collateral_amount });
await credit.collateral.withdraw({ amount: withdrawal_amount });

await credit.account.withdraw({
  asset: settlement_asset,
  amount: profit_amount,
});`),
      p("Collateral top-ups change source collateral; they are distinct from app margin. Source withdrawals require safe reservation and proof confirmation. Account withdrawals are restricted to authorized cash and the borrower recipient, with debt, pending exposure and health checks.")),
  ]),
  page("sdk/completion", "Borrower SDK", "Completion & retries", "Keep operation identifiers and resume the same operation after interruption.", [
    section("boundaries", "Completion boundaries",
      table(["Operation", "Completed when"], [
        ["intent.accept", "Reservation, verified collateral and Credit Account readiness are bound."],
        ["credit.app.execute", "Confirmed action outcomes are known; pending, partial, cancelled and failed remain distinct."],
        ["credit.repay", "Actual House accounting allocation or partial/refund outcome is confirmed."],
        ["credit.close", "Unwind or retention, repayment, release and source return are reconciled."],
        ["house.deposit", "A share mint or refund is confirmed; inbox funds alone mint no shares."],
      ])),
    section("execution", "Resume execution",
      code("Continue a submitted action", `import { ExecutionPendingError } from "@termbook/sdk";

try {
  await credit.app.execute(action, undefined, undefined, {
    timeoutMs: 60_000,
    onProgress: async (checkpoint, outcomes) => {
      await save_progress(checkpoint, outcomes);
    },
  });
} catch (error) {
  if (!(error instanceof ExecutionPendingError)) throw error;
  await save_progress(error.checkpoint, error.outcomes);
}

const result = await credit.app.resumeExecution();`),
      p("save_progress is your application persistence callback. The SDK also preserves local checkpoints where available. Pending actions keep their transaction and operation identity. A new trade requires a fresh authorization and nonce.")),
    section("closure", "Resume closure",
      code("Continue an interrupted close", `import { ClosurePendingError } from "@termbook/sdk";

try {
  await credit.close({
    onProgress: async (checkpoint) => save_closure(checkpoint),
  });
} catch (error) {
  if (!(error instanceof ClosurePendingError)) throw error;
  await save_closure(error.checkpoint);
}

await credit.close({ checkpoint: saved_checkpoint });`),
      p("A funding-required closure carries its shortfall. A blocked venue exit stays blocked or pending until the actual obligation clears. Do not create a replacement operation to hide an earlier submitted transaction.")),
  ]),
];
