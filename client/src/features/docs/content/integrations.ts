import { page, section, p, code, table, list, note, links, flow } from "../model";
import { kuruImplementation, kuruReadProgram } from "./kuru-source";

export const integrationPages = [
  page("integrations/overview", "App integrations", "Integration overview", "An app implements a standard TypeScript interface. Termbook verifies its execution, accounting and recovery rules.", [
    section("contract", "The integration contract",
      p("Your integration is a TypeScript object with metadata, a reviewable definition and three runtime interfaces: account.read, actions[capability].build and exit.next. Pick spot, perps, vault, staking or liquidity. Each use case has a uniform state shape and standard actions."),
      table(["You provide", "Termbook uses it to"], [
        ["definition", "Pin dependencies and configure shared execution, valuation and recovery rules."],
        ["account.read(context)", "Read holdings, positions, pending orders, requests and liabilities at one block."],
        ["actions.place_order.build(context)", "Build an approved bounded execution plan for a standard action."],
        ["exit.next(context)", "Plan the next safe unwind step or report a concrete wait or block."],
      ]),
      p("A platform-specific Solidity integration is not required when the shared modules can represent the app’s reads, calls and recovery policies. The definition still needs independently verifiable onchain data. Arbitrary TypeScript assertions cannot authorize borrowed funds.")),
    section("flow", "From integration to modal",
      flow([{ title: "Implement", text: "Read, build and exit" }, { title: "Validate", text: "Run lifecycle scenarios" }, { title: "Register", text: "Submit the validation ID" }, { title: "Activate", text: "Receive an app token" }]),
      list(["Register the app and prove ownership of its web origin.", "Build the integration using the SDK’s use-case type and shared assessment rules.", "Validate the exact definition against a prepared operator environment.", "Register its validation ID; authorized governance activates the configuration.", "Use the active app_token with create_termbook and open the modal."], true)),
    section("requirements", "Before you start",
      list(["A deployed app and market on the supported lending chain.", "Readable account ownership, holdings and all outstanding obligations.", "Exact ABI calls with spend caps, recipient control and price protection.", "An exit path that an approved recovery keeper can run without the borrower.", "Pinned code and implementation identities for every relevant dependency.", "An operator validation environment with funded actors and meaningful assertions."]),
      links([{ href: "/docs/integrations/kuru", title: "Follow the Kuru example", description: "See the implementation, its returned plans and the complete admission flow." }])),
  ]),
  page("integrations/definition", "App integrations", "Define the integration", "Separate immutable admission rules from runtime account reads and action plans.", [
    section("interface", "The TypeScript shape",
      code("integration.ts · interface", `import type { spot, PluginDefinition } from "@termbook/sdk";

export function create_exchange(definition: PluginDefinition,
  account: spot["account"],
  actions: spot["actions"],
  exit: spot["exit"],
): spot {
  return {
    name: definition.name,
    use_case: "spot",
    chain_id: definition.chain_id,
    markets: definition.markets,
    definition,
    account,
    actions,
    exit,
  };
}`),
      p("This factory shows the public shape. Its callbacks must be real implementations; its definition must include approved reads and call policies. See Kuru for a complete implementation rather than placeholder functions.")),
    section("definition", "Definition fields",
      table(["Field", "Meaning"], [
        ["format: 1", "The current definition schema version."],
        ["name, use_case, chain_id", "Metadata that must match the integration object."],
        ["settlement_asset", "Non-native ERC-20 asset used by the House for lending and repayment."],
        ["markets", "Market IDs, contract addresses, base and quote assets and their decimals."],
        ["actions", "Standard capabilities mapped to exact calls, bounds and routing conditions."],
        ["contracts", "Shared execution, reader, recovery and exit component addresses."],
        ["pins", "Target code hash and, for proxies, implementation identity and slot."],
        ["verified_sources", "Source identities for the pinned dependencies or an admitted runtime review."],
        ["assessment or atomic_spot", "Shared verification and recovery configuration. Choose one."],
      ]),
      p("Definitions are strict: unknown fields, duplicate markets, missing dependency pins and incomplete recovery rules are rejected. Markets, actions, sources and the runtime callbacks must agree.")),
    section("version", "Package & version identity",
      code("package.ts", `import { package_integration } from "@termbook/sdk";
import { exchange } from "./integration";

const packaged = package_integration(exchange);
console.log(packaged.hash);
console.log(packaged.version_id);`),
      p("The canonical definition hash identifies the reviewed package. The version ID includes that hash and the chain. Editing limits, actions, markets or dependencies creates a different version. package_integration checks structure; it does not replace lifecycle validation.")),
  ]),
  page("integrations/account", "App integrations", "Read account state", "Return a complete account snapshot anchored to one canonical block.", [
    section("context", "Read context",
      code("ReadContext", `{
  client,
  credit_id,
  account,
  block: { number: 123456n, hash: block_hash },
}`),
      p("Termbook supplies the public client, Credit ID, bound Credit Account and block identity. Every RPC read must use context.block.number. Return the same number and hash. Do not combine balances from latest with orders from a different block.")),
    section("holdings", "Read actual balances",
      code("read.ts · atomic spot holdings", `import { check_state, type ReadContext, type PluginStates } from "@termbook/sdk";
import { parseAbi, zeroAddress, type Address } from "viem";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export async function read_spot(context: ReadContext,
  assets: Address[],
): Promise<PluginStates["spot"]> {
  const holdings = await Promise.all(assets.map(async (asset) => {
    const amount = asset === zeroAddress
      ? await context.client.getBalance({
          address: context.account, blockNumber: context.block.number,
        })
      : await context.client.readContract({
          address: asset, abi: erc20, functionName: "balanceOf",
          args: [context.account], blockNumber: context.block.number,
        });
    return {
      holding_id: asset.toLowerCase(), asset, amount,
      held_at: context.account, controlled_by: context.account,
      withdrawable_now: amount,
    };
  }));

  return check_state("spot", {
    block: context.block, holdings, orders: [], liabilities: [],
  }, context);
}`),
      note("Atomic spot only", "Empty orders and liabilities are correct only when this integration cannot leave venue orders or obligations. An orderbook integration must also read its resting orders, partial fills and committed exposure.")),
    section("records", "Uniform records",
      table(["Record", "Required fields"], [
        ["Holding", "holding_id, asset, amount, held_at, controlled_by, withdrawable_now"],
        ["Liability", "liability_id, asset, amount"],
        ["Order", "order_id, market_id, owner, direction, input_asset, remaining_input, filled_input, output_asset, filled_output, exposure, status"],
        ["Position", "position_id, market_id, owner, assets, liability, recoverable_value + use-case fields"],
        ["Request", "request_id, owner, market_id, assets, liability, recoverable_value, claimable_at, optional replaces_position_id"],
      ]),
      p("amount and value fields are bigint. Record IDs must be unique. All owners and controlled_by values must match the Credit Account. withdrawable_now cannot exceed amount. Request claim times are Unix seconds.")),
    section("verification", "What gets checked",
      code("assess.ts", `import { assess_state } from "@termbook/sdk";

const state = await exchange.account.read(context);
const assessment = await assess_state(exchange.definition, state, context);
if (!assessment.verified) throw new Error("unverified-state");`),
      p("Assessment compares holdings with native or ERC-20 balances, compares positions and requests with shared onchain readers, reconciles orders and liabilities, rejects omitted known holdings and rechecks the canonical block hash. Reported recoverable value cannot exceed independently computed value.")),
  ]),
  page("integrations/actions", "App integrations", "Build action plans", "Translate a standard borrower action into bounded calls and verified receipts.", [
    section("context", "Action context",
      p("build receives the read context plus borrower, action and the registered market. Termbook also supplies minimum_receive or maximum_spend when the action needs price protection. A builder must reject unsupported directions, sizing and order types."),
      table(["Input", "Purpose"], [
        ["action.params", "Standard user inputs; no arbitrary calldata."],
        ["market", "The registered assets, address and decimal scales."],
        ["minimum_receive", "Minimum output for spend-sized actions."],
        ["maximum_spend", "Maximum input for receive-sized actions."],
        ["position_state", "Bound position identity, market and direction where needed."],
      ])),
    section("plan", "Returned plan",
      code("PluginPlan · an ERC-20 spend", `{
  calls: [{
    target: approved_router,
    data: encoded_trade,
    value: 0n,
    spend_asset: usdc,
    spend_amount: 100_000n,
  }],
  spending: [{ asset: usdc, maximum: 100_000n }],
  receiving: [{
    asset: native_mon,
    minimum: protected_minimum,
    controlled_by: context.account,
  }],
  completion: { kind: "atomic" },
}`),
      p("Calls execute from the Credit Account. spending is the exact aggregate budget per input asset; receiving records the output asset, minimum receipt and controlling account. A plan supports at most eight calls. Calls and budgets must match the registered definition.")),
    section("native", "Native assets & funding",
      p("For native MON, set call.value to the actual MON amount, use the zero address in spending, and set spend_amount to zero. Native value and ERC-20 allowance spending are counted separately. Do not declare the same native amount in both fields."),
      p("fundingPath in a capability definition declares how much settlement-asset credit the action needs. spendPath or valuePath declares what the account spends. A sell can spend MON already owned by the account without drawing more USDC.")),
    section("pending", "Asynchronous actions",
      code("Pending completion", `completion: {
  kind: "pending",
  deadline: expires_at,
  tracking: {
    target: market_address,
    event: "OrderSettled(bytes32,uint256,uint256)",
  },
}`),
      p("The tracking event above illustrates the format; use the app’s actual ABI event. Pending actions must declare and reconcile committed funds, fills, refunds, remaining amounts and liabilities. A successful transaction receipt alone is not a filled order.")),
    section("check", "Validate the plan",
      code("check.ts", `import { check_plan } from "@termbook/sdk";

const plan = await exchange.actions.place_order.build(context);
return check_plan(exchange.definition, context.action, plan, context);`),
      p("The SDK reconstructs the admitted execution and compares target, calldata, native value and spending. Shared onchain policies verify the allowed call and result during execution. The post-action risk check remains mandatory.")),
  ]),
  page("integrations/exit", "App integrations", "Exit & recovery", "Describe the next safe step, including cancellations and delayed withdrawals.", [
    section("interface", "exit.next(context)",
      p("The exit context includes the account snapshot, slippage policy and a minimum_receive helper. The integration chooses the next bounded step. It must support ordinary closure and keeper recovery without requiring fresh cooperation from the borrower."),
      code("PluginExit", `type ExitResult =
  | { status: "execute"; step_id: string; plan: PluginPlan }
  | { status: "wait"; tracking_id: string; retry_at: number }
  | { status: "blocked"; reason: string }
  | { status: "done" };`)),
    section("sequence", "Choose the next step",
      table(["State", "Next step"], [
        ["Resting or partially filled orders", "Request cancellation, then reconcile the final fill and refund."],
        ["Delayed redemption or unstake", "Wait for the existing request; do not submit a duplicate."],
        ["Open position", "Close, redeem or withdraw using an admitted recovery call."],
        ["Non-settlement holdings", "Execute a protected conversion into the House settlement asset."],
        ["No app obligations", "Return done; facility repayment and safe closure continue separately."],
      ]),
      p("step_id identifies the chosen operation at the observed state. retry_at is a Unix timestamp. blocked needs an actionable reason such as recovery-liquidity-unavailable.")),
    section("safety", "Required checks",
      list(["The destination stays under Credit Account or settlement-inbox control.", "Output minima and input maxima are bound to the approved recovery policy.", "Unknown liabilities or positions prevent done.", "A request and the position it replaces are not counted twice.", "Only admitted dust can remain; token balances cannot be discarded arbitrarily.", "After each step, reread and verify state before advancing."]),
      note("The modal coordinates", "The modal shows progress and requests borrower signatures when applicable. The plugin and shared contracts define executable exit rules so approved keepers can recover when the borrower is unavailable.")),
  ]),
  page("integrations/assessment", "App integrations", "Shared assessment", "Describe verifiable reads and policies instead of adding vendor-specific risk contracts.", [
    section("modules", "Shared components",
      table(["Component", "Enforcement"], [
        ["Execution policy", "Approved targets, selectors, argument constraints, native value and spend limits."],
        ["Read program", "Bounded ABI queries and deterministic conversion into uniform state fields."],
        ["Value reader", "Ownership, prices, liabilities, recovery costs and retained-value factors."],
        ["Recovery policy", "Ordered exit phases, spend bounds, receipt protection and completion checks."],
        ["Implementation guard", "The admitted target and implementation code identities."],
      ]),
      p("The developer configures these rules in the definition. The same deployed modules enforce them for each use case. Unsupported read or exit behavior needs platform work before admission; it does not become safe because the TypeScript object matches a type.")),
    section("configuration", "Assessment configuration",
      table(["Field", "Define"], [
        ["read_program, state_target, reads", "ABI programs for meta, positions, pending reconciliation and requests."],
        ["assets, markets", "Asset decimals, oracle/feed, holding and exposure limits, quote programs and receipts."],
        ["retained_bps, recovery_costs", "Conservative value retained and settlement-unit recovery costs."],
        ["max_positions, max_pending, max_requests", "Portfolio bounds the reader and recovery loop can handle."],
        ["action_limits, calls", "Per-action funding/exposure limits and exact/range/account/spend constraints."],
        ["recovery", "Pending, request, position and holding-phase exit calls."],
        ["prices", "Direction, amount, price scales, oracle deviation, slippage and authorization age."],
      ])),
    section("programs", "Build a read program",
      p("ReadProgramBuilder and compile_read_program are exported by the SDK. Programs make bounded static reads against pinned contracts. They cannot run arbitrary JavaScript onchain. The Kuru quote program checks market parameters, status and available bid depth before computing recoverable proceeds."),
      links([{ href: "/docs/integrations/kuru#quote-program", title: "Kuru’s read program", description: "Read the complete builder used for the atomic spot integration." }])),
    section("activate", "Prepare activation calls",
      code("activation.ts", `import { prepare_use_case, prepare_atomic_spot } from "@termbook/sdk";

const options = {
  client, registry, core, health_source, health_factory,
  max_health_age: 90,
};

const prepared = exchange.definition.atomic_spot
  ? await prepare_atomic_spot(exchange.definition, {
      ...options,
      max_slippage_bps: 50,
      max_deviation_bps: 100,
      max_authorization_age: 90,
    })
  : await prepare_use_case(exchange.definition, options);

const calls = prepared.calls;`),
      p("These SDK helpers prepare governance transactions; they do not make the author an administrator. Authorized activation must configure the readers, policies, recovery components and integration version before an app token becomes active.")),
  ]),
  page("integrations/kuru", "App integrations", "Kuru: complete example", "The bundled atomic spot adapter implements the same interface other apps use.", [
    section("scope", "What this integration supports",
      table(["Feature", "Current Kuru adapter"], [
        ["Use case", "Spot: native MON / Circle test USDC."],
        ["Actions", "Market buy and market sell, sized by amount.spend."],
        ["Custody", "Purchased MON or USDC returns to the bound Credit Account."],
        ["Orders", "Atomic execution; this adapter does not expose resting limit orders."],
        ["Exit", "Protected sell of remaining MON; done only after approved dust and obligation checks."],
        ["Assessment", "Shared atomic spot module plus a pinned, depth-aware read program."],
      ]),
      p("The implementation lives in server/src/kuru/integration.ts. An external team implements its own module using import type { spot } from @termbook/sdk. Kuru’s SDK or API can help build quotes, but execution and custody are still verified against its contracts.")),
    section("create", "Create the adapter",
      code("operator.ts · repository usage", `import { createPublicClient, http, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import { pluginDefinitionSchema } from "@termbook/schema";
import { create_kuru } from "./server/src/kuru/integration.js";
import deployment from "./deployments/testnet.json" with { type: "json" };

const definition = pluginDefinitionSchema.parse(
  deployment.configuration["kuru-integration"].definition,
);
const risk = definition.atomic_spot;
if (!risk) throw new Error("atomic-spot-configuration-required");

const client = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.RPC_URL),
});

const kuru = await create_kuru({
  client,
  api_base: process.env.PUBLIC_API_BASE!,
  market_address: definition.markets[0]!.address as Address,
  settlement_asset: definition.settlement_asset as Address,
  maximum_input: BigInt(risk.maximum_input),
  retained_bps: risk.retained_bps,
  recovery_costs: BigInt(risk.recovery_costs),
  max_holding: BigInt(risk.max_holding),
  dust_limit: BigInt(risk.dust_limit),
  oracle: risk.oracle as Address,
  feed_id: risk.feed_id as Hex,
});`),
      p("This reads the existing admitted market, feed and risk limits from deployments/testnet.json. RPC_URL and PUBLIC_API_BASE come from the operator environment. Borrower apps use the resulting app token rather than this operator configuration.")),
    section("implementation", "Integration implementation",
      p("This is the current source, including initialization checks, call mapping, account reading and exit planning. It pins market, vault, factory, margin account, forwarder, assets, oracle and shared components."),
      code("server/src/kuru/integration.ts", kuruImplementation)),
    section("quote-program", "Quote & recovery depth",
      p("The quote program validates the market’s parameter hash and state, reads bounded bid depth and calculates proceeds after fees. Recovery value uses executable depth and policy retention rather than an arbitrary frontend quote."),
      code("server/src/kuru/read.ts", kuruReadProgram)),
    section("admission", "Validate & register",
      code("admit.ts", `import { create_sdk } from "@termbook/sdk";

const sdk = create_sdk({
  application_id,
  wallet: developer_wallet,
  api_base,
  validation_environment,
});

const validation = await sdk.integrations.validate({
  plugin: kuru,
  wallet: developer_wallet,
  amount: 100_000n,
});

if (!validation.passed) throw new Error(validation.failures.join("; "));
const registration = await sdk.integrations.register({
  validation_id: validation.id,
});

if (registration.status === "active") {
  console.log(registration.app_token);
}`),
      p("The environment provides deployment-bound lifecycle scenarios, funded House liquidity, borrower and separate keeper actors. register can return awaiting_approval. Use status with the same validation ID after authorized activation."),
      note("Testnet security policy", "Kuru’s current testnet OrderBook has an explicit exact-runtime review exception and a trusted upgrade monitor. That monitor has a detection window. This is an admitted testnet trust assumption, not mainnet source verification.")),
  ]),
  page("integrations/validation", "App integrations", "Validate & register", "Test the lifecycle of the exact deployment before issuing an app token.", [
    section("environment", "Prepare the environment",
      p("The SDK owns validation. A ValidationEnvironment supplies the client, durable checkpoint options and prepare callback with concrete acceptance scenarios. It funds or binds the House, borrower and independent recovery actor. It is not a browser-only ABI smoke test."),
      p("create_validation_environment supports executable validation programs. create_evidence_environment binds recorded scenario evidence. Evidence must identify the chain, Core, integration version, dependencies and lifecycle transactions; isolated fixtures do not certify another deployment.")),
    section("scenarios", "Required scenarios",
      list(["Draw credit and execute every admitted action variant.", "Verify actual account custody, balances, positions, liabilities and recoverable value.", "Reject wrong recipients, excess spending, unsupported actions, stale authorizations and unsafe health.", "Reconcile partial fills, cancellations and delayed requests when supported.", "Repay the House and confirm accounting, then close and return collateral.", "Recover through an independent keeper without the borrower.", "Resume interrupted operations and prove replay or duplicate execution cannot reuse authorization.", "Bind dependency upgrade behavior to the admitted guard or explicit monitoring policy."]),
      p("Unsupported scenarios require valid use-case exclusions. Every applicable acceptance case must run. A passed result is bound to the exact package hash and version ID.")),
    section("kuru-suite", "Run the Kuru suite",
      code("Terminal 1 · fork the deployment", `anvil --fork-url "$RPC_URL" --chain-id 10143 --port 18548`, "shell"),
      code("Terminal 2 · from the repository root", `node --env-file=.env --import tsx server/test/kuru/run-acceptance.ts http://127.0.0.1:18548 --deployment`, "shell"),
      p("The deployment mode binds tests to deployments/testnet.json and uses the configured independent RISK_KEEPER_KEY. It runs and replays acceptance scenarios against an isolated fork, with explicit exclusions for unsupported features. The runner writes its report to a temporary directory and prints that path."),
      p("A fork report needs the admission review and actual live lifecycle bindings before it can certify a deployed version. The SDK then verifies callbacks against recorded active and recovered Credits. Do not present an isolated fixture report as a live acceptance result.")),
    section("run", "Run SDK validation",
      code("validate.ts", `const report = await sdk.integrations.validate({
  plugin: exchange,
  wallet: developer_wallet,
  amount: 100_000n,
});

// amount is in the House settlement asset’s smallest unit.
if (!report.passed) {
  throw new Error(report.failures.join("; "));
}

const result = await sdk.integrations.register({
  validation_id: report.id,
});`),
      table(["Validation result", "Meaning"], [
        ["id", "Validation ID used for registration."],
        ["passed, failures", "Result and concrete failed requirements."],
        ["version_id, package_hash", "The definition and version tested."],
      ])),
    section("activation", "Activation & token",
      code("Registration result", `{
  integration_id: validation_id,
  version_id,
  status: "awaiting_approval",
}

// After authorized activation:
{
  integration_id: validation_id,
  version_id,
  status: "active",
  app_token: "tbk_…",
}`),
      p("The validation ID is not an app token. Validation expires before activation under the configured window, currently 24 hours. register and status use the same ID so a retry does not create another integration. The authorized operator uses approve; an ordinary app author cannot activate its own risk rules.")),
  ]),
  page("integrations/origins", "App integrations", "Origin & version control", "Bind the frontend owner and keep the admitted code identity enforceable.", [
    section("origin", "Register the application",
      code("POST /applications · signed owner request", `{
  "name": "My Exchange",
  "origin": "https://trade.myexchange.com",
  "chainId": 10143
}`, "json"),
      p("The API returns the application ID and a DNS challenge. Publish the supplied value as a TXT record at _termbook.trade.myexchange.com, then submit the signed POST /applications/:id/verify-origin request. Ownership is checked before verification and registration."),
      note("Local development", "Explicit local origins are allowed only by the configured testnet operator policy. A localhost exception is not a production domain-ownership proof.")),
    section("auth", "Signed requests",
      p("Owner requests use a server nonce bound to wallet, HTTP method, path, body hash, expiry and API domain. The SDK’s author client checks the challenge and signs it through the configured wallet. A nonce is single use; a signature for one body cannot authorize a different request.")),
    section("upgrades", "Dependency upgrades",
      p("The definition pins target bytecode and proxy implementation identity. A changed dependency requires review, a new version and validation before new borrowing is admitted. Shared guards check approved identities during action execution; full lifecycle validation is not rerun before every trade."),
      p("A proxy must expose an enforceable upgrade identity or use an explicitly admitted trust model. An RPC implementation-slot read alone cannot enforce that identity inside the execution transaction. A trusted testnet monitor can pause borrowing after detecting an upgrade, with a detection window.")),
    section("versions", "App tokens & versions",
      p("An active token resolves the integration’s version, capabilities, Core, network and public API configuration. Keep frontend actions within that version’s supported routes. If a token expires, its origin is wrong or the version is disabled, surface the error and request current configuration.")),
  ]),
];
