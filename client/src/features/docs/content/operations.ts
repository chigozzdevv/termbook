import { page, section, p, code, table, list, note, links } from "../model";

export const operationPages = [
  page("houses/overview", "Houses & LPs", "House policies", "A House supplies credit and chooses the integrations and risk terms it will fund.", [
    section("house", "What a House manages",
      p("HouseVault holds the settlement asset and accounts for liquid cash, committed facilities, receivables, reserves and realized losses. The operator admits integrations and collateral markets within protocol constraints. LPs fund that House; they do not directly own a borrower’s Credit Account."),
      table(["Policy", "Set"], [
        ["Assets and integrations", "Settlement token, admitted collateral and permitted app versions."],
        ["Credit terms", "Limit, duration, maturity, grace, revolving capacity and draw bounds."],
        ["Economics", "Interest, origination and commitment fees, reservation bond and abandonment charges."],
        ["Risk", "Health thresholds, retained values, portfolio bounds and concentration limits."],
        ["Execution", "Slippage, price deviation, oracle age, authorization age and withdrawal bounds."],
        ["Recovery", "Approved keepers, exit rules, loss bounds and supported settlement routes."],
      ])),
    section("offers", "Offers & reservations",
      p("The House signs offers for an intent and a specific policy version. The borrower reviews the fees, collateral binding, setup deadline and maturity before acceptance. Reservation prevents the same liquidity from being promised twice; drawn debt accrues under the accepted terms."),
      p("The operator cannot use a permissive frontend quote to bypass Core’s accounting or risk floor. Changed policies apply through versioned configuration and the rules for already accepted facilities.")),
    section("read", "Read a House",
      code("house.ts", `const house = termbook.house(house_address);
const summary = await house.summary();
const integrations = await house.integrations({ active: true });
const activity = await house.activity();`),
      p("These methods read the House resource. They do not grant operator or governance authority. Mutations use the appropriate signer and the vault’s configured permissions.")),
  ]),
  page("houses/liquidity", "Houses & LPs", "Supply & withdraw", "Deposit the settlement token and receive shares in a House’s net assets.", [
    section("deposit", "Deposit",
      code("Deposit 10 USDC · direct Monad funding", `const house = termbook.house(house_address);
const deposit = await house.deposit({
  amount: 10_000_000n,
  minShares: reviewed_minimum_shares,
  deadline: Math.floor(Date.now() / 1000) + 300,
});

console.log(deposit.status, deposit.shares);`),
      p("minShares is the minimum share amount from the reviewed exchange rate, expressed in the vault’s share units. deadline is Unix seconds. The SDK verifies approval, deposit and the confirmed share mint. A remote deposit requires an admitted Aurora route and completes only after settlement allocation.")),
    section("account", "LP account",
      code("Read shares and request withdrawal", `const account = house.account(wallet.address);
const summary = await account.summary();

await account.withdraw({
  amount: 1_000_000n,
  to: wallet.address,
});

const withdrawals = await account.withdrawals();`),
      p("Withdrawal amount is in the settlement asset’s smallest unit. The vault converts it to shares at the current accounting price. Rounding affects the actual amount; the SDK returns that amount.")),
    section("queue", "Withdrawal queue",
      code("Claim or cancel a queued withdrawal", `await account.claim(withdrawal_id);
await account.cancel_withdrawal(withdrawal_id);`),
      p("These are alternatives for an eligible queue record, not sequential steps for one record. If free cash is sufficient, the withdrawal can use the immediate path. Otherwise it queues under the vault’s liquidity rules. Queued requests preserve the owner, recipient, shares and claim state.")),
    section("risk", "Share value & lending risk",
      p("Shares represent House net assets, not a guaranteed USDC balance. Lending returns, fees and losses change share price. Illiquid receivables can delay cash withdrawals. Pending inbox funds create no LP shares until a valid deposit is applied.")),
  ]),
  page("reference/actions", "Reference", "Actions & units", "One action envelope, with parameters defined by use case and capability.", [
    section("envelope", "Action envelope",
      code("StandardAction", `{
  use_case: "spot",
  capability: "place_order",
  params: {
    market_id: "MON-USDC",
    direction: "buy",
    order_type: "market",
    amount: { spend: 100_000n },
    slippage_bps: 50,
  },
}`),
      p("use_case distinguishes spot place_order from perps place_order. capability names the operation. params has a strict use-case schema; undeclared fields and incompatible combinations are rejected.")),
    section("rules", "Common parameter rules",
      table(["Input", "Rule"], [
        ["Amounts", "Positive uint256 for action quantities; bigint, decimal string or safe integer."],
        ["Token decimals", "Use the market’s declared scale, not a universal decimal count."],
        ["slippage_bps", "Schema range 0–5000; integration and House limits can be stricter. 50 = 0.5%."],
        ["expires_at", "Future Unix seconds, at most 30 days from action validation."],
        ["market_id / position_id / order_id", "Registered identifiers, not a replacement for custody verification."],
        ["Spot amount", "Exactly one of spend or receive."],
        ["Market protection", "slippage_bps; no limit_price or expires_at in the market-order schema."],
        ["Limit protection", "limit_price and expires_at; no market slippage field."],
        ["Liquidity assets", "Unique asset IDs; 1–16 amounts."],
      ])),
    section("catalog", "Capability catalog",
      links([
        { href: "/docs/integrations/spot#capabilities", title: "Spot", description: "Place, modify and cancel buy or sell orders." },
        { href: "/docs/integrations/perps#capabilities", title: "Perps", description: "Open, change margin, reduce and close positions." },
        { href: "/docs/integrations/vault#capabilities", title: "Vaults", description: "Deposit, redeem, claim and complete withdrawals." },
        { href: "/docs/integrations/staking#capabilities", title: "Staking", description: "Stake, claim, request and complete unstaking." },
        { href: "/docs/integrations/liquidity#capabilities", title: "Liquidity", description: "Add, remove, stake, collect and withdraw LP positions." },
      ])),
  ]),
  page("reference/api", "Reference", "API & authentication", "Use the SDK for signed flows or call the API with the same authorization bindings.", [
    section("reads", "Public reads",
      table(["Route", "Use"], [
        ["GET /health", "Process health."],
        ["GET /ready", "Finalized indexing and risk-scan readiness."],
        ["GET /catalog", "Supported chains, assets, Houses and integrations."],
        ["GET /integrations/config?app_token=…", "Resolve the token’s admitted SDK configuration."],
        ["GET /integrations/validation", "Current acceptance requirements."],
        ["GET /integrations/platform/spot", "Shared atomic spot component addresses."],
        ["GET /integrations/platform/use-case", "Shared use-case component addresses."],
        ["GET /credits/:id", "Indexed credit details."],
        ["GET /credits/:id/positions", "Tracked app positions."],
        ["GET /credits/:id/pending", "Pending app actions."],
        ["GET /settlement/:id", "Settlement operation state."],
      ])),
    section("signed", "Signed mutations",
      table(["Route", "Signer / purpose"], [
        ["POST /auth/nonce", "Request the challenge for one method, path and body hash."],
        ["POST /applications", "Owner: register a name, HTTPS origin and chain."],
        ["POST /applications/:id/verify-origin", "Owner: confirm DNS ownership proof."],
        ["POST /integrations/packages/validate", "Author: submit deployment-bound acceptance evidence."],
        ["POST /integrations/packages/register", "Author: register a passed validation ID."],
        ["POST /integrations/packages/approve", "Authorized operator: activate the admitted version."],
        ["POST /intents", "Borrower: submit a credit request."],
        ["POST /settlement", "Payer: register a bound settlement operation."],
      ])),
    section("headers", "Authorization headers",
      code("Signed request headers", `x-termbook-wallet: <signing EVM address>
x-termbook-signature: <signed challenge>
x-termbook-nonce: <single-use server nonce>`, "text"),
      p("The server binds the signature to the actual method, path and canonical body hash. The SDK checks the challenge domain and expiry before asking the wallet to sign. App-specific routes can also require x-termbook-app-token and origin checks. Rate limits return 429 with retry guidance.")),
    section("truth", "State authority",
      p("Indexed API records make progress and history convenient to read. Onchain custody, authorization, debt and risk enforcement remain authoritative. Do not use an indexed status alone to declare a transaction finalized or a facility safely closed.")),
  ]),
  page("reference/errors", "Reference", "Errors & outcomes", "Show the failed condition and preserve progress when an operation is pending.", [
    section("outcomes", "Execution outcomes",
      table(["Status", "Meaning"], [
        ["settled", "The tracked action reached its confirmed settled outcome."],
        ["partial", "Some execution completed; inspect fills, remaining amounts and liabilities."],
        ["pending", "External settlement or reconciliation still remains."],
        ["cancelled / expired", "The remainder ended; previous partial fills can still exist."],
        ["failed", "Execution failed; inspect its error and any already settled external state."],
      ])),
    section("integration", "Integration errors",
      table(["Error", "Resolve"], [
        ["integration-validation-environment-unavailable", "Configure a real operator validation environment."],
        ["integration-definition-mismatch", "Align metadata, markets, declared actions and callbacks."],
        ["integration-assessment-required", "Provide assessment or atomic_spot configuration."],
        ["integration-state-block-mismatch", "Read and return the same canonical snapshot block."],
        ["integration-custody-invalid", "Correct owner bindings and duplicate or invalid records."],
        ["integration-plan-mismatch", "Match admitted targets, calldata, native value and completion."],
        ["integration-spend-mismatch", "Match aggregate spending to actual bounded calls."],
        ["integration-value-overstated", "Report no more than independently recoverable position value."],
      ])),
    section("sdk", "Client & operation errors",
      table(["Error / class", "Resolve"], [
        ["app-token-invalid / app-config-unavailable", "Use an active token and reachable public API origin."],
        ["action-use-case-mismatch / capability-denied", "Use an action admitted by this version."],
        ["action-params-invalid / action-expiry-invalid", "Use the strict standard shape and current bounds."],
        ["ExecutionPendingError", "Keep the execution checkpoint and resume reconciliation."],
        ["ClosurePendingError", "Keep the closure checkpoint and resume the same operation."],
        ["ClosureFundingRequiredError", "Fund the reported shortfall through the approved repayment path."],
        ["PaymentPendingError / LocalPaymentPendingError", "Resume the payment; do not double-fund it."],
        ["settlement-route-unavailable", "Select an admitted provider route available for these assets and networks."],
      ])),
  ]),
  page("operators/local", "Operators", "Local services", "Run the API and workers with Docker-backed persistence.", [
    section("start", "Start persistence",
      code("From the repository root", `docker compose -f docker-compose.testnet.yml up -d
pnpm install
pnpm build`, "shell"),
      p("The testnet compose stack starts MongoDB with a one-member replica set and Redis. MongoDB listens locally on 27018, Redis on 6380. Database state lives in the Docker volume; there is no native MongoDB data folder to maintain.")),
    section("environment", "Configure the root environment",
      code(".env · local service values", `PORT=3002
MONGO_URL=mongodb://127.0.0.1:27018/termbook_testnet_upgradeable?replicaSet=rs0&directConnection=true
REDIS_URL=redis://127.0.0.1:6380
MONAD_CHAIN_ID=10143
AUTH_DOMAIN=api.termbook.local
PUBLIC_API_BASE=http://127.0.0.1:3002`, "shell"),
      p("Add the current deployment addresses, finalized deployment block, public RPC and collateral/feed configuration from deployments/testnet.json. server/.env.example documents available variables. Keep API keys and signer keys in the ignored root environment or approved key files, not in docs or public manifests.")),
    section("processes", "Start API & workers",
      code("Terminal 1 · API", `node --env-file=.env server/dist/server.js`, "shell"),
      code("Terminal 2 · worker", `node --env-file=.env server/dist/worker.js`, "shell"),
      code("Terminal 3 · client", `pnpm dev:client`, "shell"),
      p("The client runs on 4178. /health confirms API process health. /ready additionally checks fresh finalized indexing and healthy risk scans; a running server does not necessarily mean lending services are ready.")),
    section("storage", "What persists",
      table(["Location", "Contents"], [
        ["MongoDB Docker volume", "Intents, credits, integration validation, indexed events, queues and operation progress."],
        ["Redis", "Queue coordination when configured; MongoDB provides the durable fallback queue."],
        ["deployments/testnet.json", "Public deployed addresses and completed setup configuration."],
        [".testnet/", "Private operational wallet keys. Do not publish or delete funded identities casually."],
        [".data/operations", "Active signed-transaction journals created before broadcast; completed temporary journals are removed."],
      ]),
      p("Deleting a database volume resets local application state, not blockchain state. Rescanning restores finalized indexed events, but it cannot recreate arbitrary private authoring data or lost wallet keys.")),
  ]),
  page("operators/indexing", "Operators", "Envio & indexers", "Index finalized events efficiently while verifying their canonical chain identity.", [
    section("envio", "Configure Envio HyperSync",
      code("Root .env", `ENVIO_API_TOKEN=your_hypersync_token
ENVIO_HYPERSYNC_URL=https://10143.hypersync.xyz`, "shell"),
      p("With a token, the worker uses Envio HyperSync for Core event retrieval. The default endpoint follows MONAD_CHAIN_ID; the URL can be overridden. Without a token, the bounded RPC indexer is used.")),
    section("verification", "Checkpoint rules",
      list(["Read only through the RPC’s finalized head.", "Retrieve bounded event pages and resume from the archive’s returned boundary.", "Verify event data against RPC transaction receipts.", "Check canonical block hashes before advancing the durable checkpoint.", "Leave the checkpoint unchanged if an archive page is unavailable."], true),
      p("HyperSync can reduce historical event retrieval overhead. It does not shorten source collateral finality, bypass Guardian attestations or authorize actions. The database checkpoint survives worker restart.")),
    section("workers", "Worker responsibilities",
      table(["Worker path", "Job"], [
        ["Finalized indexing", "Track Core lifecycle and accounting events."],
        ["Risk scanning", "Read active facilities and schedule authorized recovery when required."],
        ["Price refresh", "Update admitted ratio feeds and execution-price checkpoints."],
        ["Source actions", "Submit and reconcile collateral return or seizure authorizations."],
        ["Settlement", "Track actual provider delivery and apply or refund received value."],
        ["Upgrade monitor", "Pause admitted testnet targets after a detected dependency change."],
      ])),
  ]),
  page("operators/deployment", "Operators", "Deploy & upgrade", "Simulate, verify bindings and apply governed changes to the existing deployment.", [
    section("checks", "Before broadcasting",
      code("Repository checks", `pnpm typecheck
pnpm lint
pnpm test
forge test --root contracts/evm
cd contracts/solana && cargo test --offline`, "shell"),
      p("Run the relevant full suites and deployment simulation. Confirm network identities, signer balances, gas estimates, source custody authorities, admitted feeds and settlement token addresses. A House and market must use the same settlement token contract.")),
    section("upgrade", "Upgradeable deployments",
      p("EVM proxy upgrades preserve the proxy address and storage. Implementation code changes require storage-layout checks and authorized governance execution. Deploying a new implementation is not the same as replacing a proxy and its address."),
      p("The Solana program uses its configured upgrade authority. Upgrading its executable can preserve the program ID; authority and account compatibility still need verification. Testnet single-key governance does not establish production multisig controls.")),
    section("commands", "Deployment tooling",
      code("Inspect current bindings", `node scripts/verify-testnet-integrations.mjs`, "shell"),
      p("scripts/deploy-testnet.mjs creates a fresh deployment and refuses to overwrite an existing manifest. scripts/upgrade-testnet.mjs handles the existing upgrade path. Setup runners support simulation before broadcast. Use the existing deployment manifest rather than inventing another address file.")),
    section("live", "After execution",
      list(["Verify receipts, runtime identities, initialized proxy state and storage compatibility.", "Verify sources and updated dependencies against the exact implementation bytecode.", "Confirm feeds, House policies, liquidity, account factory and keeper permissions.", "Restart services with current public configuration and check /ready.", "Run deployment-bound borrowing, repayment, closure and borrower-independent recovery."], true),
      note("Client status", "The current web client’s market and House views use mock records. The docs describe the implemented protocol and SDK; a displayed mock row is not a live loan or liquidity balance.")),
  ]),
  page("security/trust", "Security", "Trust & controls", "Understand custody, attestations, governance and operational assumptions.", [
    section("boundaries", "Trust boundaries",
      table(["Boundary", "Assumption"], [
        ["Credit Account", "Onchain authorization, approved calls, spending and post-action checks hold."],
        ["Collateral custody", "The admitted source vault or program enforces lock and authorized release."],
        ["Remote proof", "Wormhole Guardian quorum and admitted finality rules are trusted."],
        ["Price and recoverability", "Admitted oracles and verified exit depth remain available within policy bounds."],
        ["App dependencies", "Pinned code or the explicitly admitted upgrade-monitor model is respected."],
        ["Governance", "Authorized administrators can configure and upgrade components under the deployed controls."],
        ["Services", "Relays and keepers remain available; outages can delay completion."],
        ["Aurora routes", "The admitted provider delivers or refunds within the bound route policy."],
      ])),
    section("runtime", "Enforce during execution",
      list(["Borrower authorization and nonce freshness.", "Exact approved integration version and dependency identities.", "Account-controlled recipient and bounded spend.", "Minimum receipts, price deviation and slippage.", "Pending exposure, liabilities and portfolio limits.", "Post-action health and safe withdrawal or release."]),
      p("The admission suite establishes lifecycle behavior for a version. Runtime checks constrain each action against that version. Neither the developer’s TypeScript report nor the server’s indexed state alone can approve unsafe onchain execution.")),
    section("testnet", "Explicit testnet policies",
      p("The current environment uses single-key governance, configured faster Ethereum confirmations and a trusted monitor for Kuru’s proxy. Kuru’s exact-runtime source exception is bounded and time-limited. These choices must remain visible; they do not justify calling the entire system trustless.")),
    section("production", "Production admission",
      p("Production requires the chosen governance ownership and delay policy, reviewed implementation and source identities, admitted mainnet custody and feeds, executable conversion routes, funded services and deployment-bound recovery validation. Public documentation must describe the actual deployed trust model.")),
  ]),
];
