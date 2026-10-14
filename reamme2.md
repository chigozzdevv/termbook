# Termbook

Borrow to use Monad apps, with collateral on the chain you already use.

Termbook connects borrowers with **Houses**, lending pools funded by liquidity providers. A borrower locks collateral, accepts a House offer and uses USDC inside an approved app. The borrowed funds and purchased assets stay in a **Credit Account**, where the protocol enforces spending and repayment rules.

[App](https://termbook.xyz) · [Docs](https://termbook.xyz/docs) · [Demo video](https://youtu.be/DZBNAsH82t0) · [SDK](https://www.npmjs.com/package/@termbook/sdk)

## How it works

1. **Choose credit.** Review a House offer, including its limit, rate, collateral and repayment date.
2. **Lock collateral.** Lock MON, ETH or SOL in a supported vault or program. Remote collateral stays on its source chain.
3. **Use an app.** Once the collateral proof is accepted, draw USDC into the Credit Account and execute an approved action.
4. **Repay and close.** Exit app positions, repay in the House's lending asset and return the collateral. Any remaining account assets belong to the borrower.

Credit can exceed the value of the initial collateral when the assets bought with the loan provide enough recoverable backing. House limits and health checks determine how much can be borrowed. A ready facility can fund more than one action within its terms.

If a loan defaults, an approved keeper can unwind its app positions and recover the debt without the borrower's cooperation.

## Try the demo

Open [Kuru on Termbook](https://termbook.xyz/app/kuru). The demo lends **test USDC on Monad testnet** and trades the Kuru MON/USDC market.

You need:

- An EVM wallet with test MON for transactions on Monad testnet (`10143`).
- Collateral on a supported test network. For SOL, also connect a Solana wallet set to devnet.
- Test USDC for any repayment shortfall after selling, including trading costs and interest. Repayment uses USDC even when collateral is SOL, ETH or MON.

Choose **Use Termbook**, review an offer and complete collateral setup in the modal. Start with a **0.01 USDC buy**, then sell, repay and close. Keep the modal open while a cross-chain proof is pending; collateral acceptance and return take longer than a Monad transaction.

The automated testnet offers are capped at **0.1 USDC**. A trade must also fit the market's available liquidity and the account's health limit. The chart shows mainnet reference prices; the order book and executions use the testnet market. All assets in this demo are test assets.

See [networks, assets and addresses](https://termbook.xyz/docs/getting-started/networks) before funding a wallet.

## Integrate Termbook

### Install the SDK

```sh
npm install @termbook/sdk viem
```

An app uses the SDK and Termbook API. It does not need to run a database, indexer or keeper to embed the modal.

### Open the modal

This example buys **0.01 USDC worth of MON** on the admitted Kuru testnet market. Pass your app's connected viem wallet client and the active app token for that integration.

```ts
import { create_termbook, evm_wallet } from "@termbook/sdk";
import type { WalletClient } from "viem";

export async function open_credit(
  wallet_client: WalletClient,
  app_token: string,
) {
  const termbook = create_termbook({
    app_token,
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
}
```

Call `open_credit` from your **Use Termbook** button after connecting the wallet to Monad testnet. Amounts use the token's smallest units: `10_000n` is 0.01 USDC, and `50` basis points is 0.5% slippage.

The SDK resolves the integration's network and contract addresses. The modal handles credit setup, collateral wallet connection, action review and transaction approval. Opening it does not authorize a loan or trade.

### Get an app token

For a new integration, implement the SDK's standard interface for your use case. It describes how to read account state, build actions and exit positions. Termbook validates the actual trading and recovery lifecycle against the deployed app.

Register the passed validation ID, then obtain activation for the reviewed version. Its `app_token` selects those approved rules in the modal. The token is a public integration identifier; it cannot sign transactions or move funds.

[Integration guide](https://termbook.xyz/docs/integrations/overview) · [Kuru implementation](server/src/kuru/integration.ts) · [SDK reference](https://termbook.xyz/docs/sdk/quickstart)

## Supported networks and integrations

| Feature | Available today |
| --- | --- |
| Lending and app execution | Monad testnet (`10143`), with USDC lending |
| MON collateral | Monad testnet |
| ETH collateral, wrapped as WETH | Ethereum Sepolia (`11155111`) and Base Sepolia (`84532`) |
| SOL collateral | Solana devnet |
| Kuru spot trading | Market orders, limit orders, cancellation and keeper recovery |
| Other app types | SDK interfaces for perps, vaults, staking and liquidity; each app needs validation and admission |
| Aurora value routing | Repayment, LP deposit and recovery routing code; testnet routes are not available |
| Mainnet | Not activated |

Contract addresses and admitted versions are in [deployments/testnet.json](deployments/testnet.json).

## Architecture and security

| Component | Responsibility |
| --- | --- |
| Credit Account | Holds borrowed funds, purchased assets and app positions; executes approved calls |
| House | Holds LP liquidity, sets lending terms and accounts for loans and losses |
| Core and shared risk modules | Enforce permissions, spending bounds, prices, account health and recovery |
| Source vaults and programs | Hold collateral and process authorized returns or seizures |
| API, database and Envio indexer | Serve requests and indexed activity; store application state and table snapshots |
| Keepers | Relay proofs, refresh prices and perform authorized recovery and bounded testnet upkeep |

Borrowers own their Credit Accounts, but cannot freely withdraw assets backing an active loan. The protocol checks asset control and recoverable value after app actions. House managers set lending policies; that role does not let them withdraw other LPs' shares.

Remote collateral proofs rely on **Wormhole's Guardian quorum** and the configured source confirmation policy. The testnet Ethereum route uses five-block confirmations, Base uses safe blocks and Solana uses finalized state. Faster confirmation policies accept additional reorganisation risk.

This deployment also trusts its upgrade administrators, price sources and admitted app dependencies. Testnet governance has no execution delay, and Kuru's testnet upgrade-monitor expiry checks are disabled. Contract permissions, code pins, price protection and health checks remain in place. These settings are for testing and do not establish mainnet readiness.

[Custody and permissions](https://termbook.xyz/docs/concepts/accounts) · [Health checks](https://termbook.xyz/docs/concepts/health) · [Trust assumptions](https://termbook.xyz/docs/security/trust)

## Proof of execution

Selected transactions from completed testnet runs:

| Action | Transaction |
| --- | --- |
| Borrow USDC and buy MON on Kuru | [View transaction ↗](https://testnet.monadscan.com/tx/0xecf743e3493c5b0f844dc70a08a0410e69a71c61533ec711c15908db8503a210) |
| Repay the same loan | [View transaction ↗](https://testnet.monadscan.com/tx/0x2d444cc662d691c976cef3cc2462ac61f96557d83ab868298f34b81aaf59c2c0) |
| Close the account | [View transaction ↗](https://testnet.monadscan.com/tx/0x9f4ca9b38e5060260ededf61655f833c5ad48803b628f219b2cc5c8e83dee9c6) |
| Recover debt from a defaulted Kuru loan | [View transaction ↗](https://testnet.monadscan.com/tx/0x7db53a9736c3a01f8287005eaa763548e539b441a580bc415eb2b9a6fd6de8f5) |

See the [complete execution records](README.md#proof-of-execution) for collateral return, cross-chain loans and keeper recovery, and the [deployment manifest](deployments/testnet.json) for admission records.

## Development

Repository setup is for contributors and operators. App developers can use the published SDK above.

Use Node.js 22+ and pnpm 10:

```sh
git clone https://github.com/chigozzdevv/termbook.git
cd termbook
pnpm install --frozen-lockfile
pnpm --filter '@termbook/sdk...' build
pnpm dev:client
```

The client runs at `http://127.0.0.1:4178`. Set `NEXT_PUBLIC_TERMBOOK_API_URL` in `client/.env.local` to the API you are using. The local default is `http://127.0.0.1:3002`.

| Directory | Contents |
| --- | --- |
| `client/` | Web app and documentation |
| `packages/` | SDK, shared schemas and contract bindings |
| `contracts/` | EVM contracts and Solana collateral program |
| `server/` | API, app integrations, indexers and keepers |
| `deployments/` | Public deployment addresses and configuration |
| `deploy/` | Hosting configuration |

For databases, API services, workers and deployment, follow the [operator guide](https://termbook.xyz/docs/operators/local) and [deployment guide](https://termbook.xyz/docs/operators/deployment).
