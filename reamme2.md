# Termbook

**Cross-chain credit for Monad apps, with less upfront collateral.**

Lock SOL, ETH or MON on a supported chain and borrow USDC to use in Monad apps. The assets and positions funded by the loan also help back the debt, so eligible loans can require less upfront collateral.

Collateral stays on its source chain. Borrowed funds and app assets stay in a **Credit Account** with enforced spending and repayment rules. **Houses** are lending pools funded by liquidity providers; their managers set loan terms and risk limits.

[App](https://termbook.xyz) · [Docs](https://termbook.xyz/docs) · [Demo video](https://youtu.be/DZBNAsH82t0) · [SDK](https://www.npmjs.com/package/@termbook/sdk)

## How it works

To borrow, use SOL on Solana devnet, ETH on Base Sepolia or Ethereum Sepolia, or MON on Monad testnet. Connect your Monad wallet, then follow the modal through these steps:

1. **Choose an offer.** Select **Use Termbook** in a supported app. Review the credit limit, interest rate, collateral requirement and repayment date.
2. **Lock collateral.** Approve the lock in your source wallet. Termbook verifies the collateral proof before making the credit available.
3. **Borrow and use the app.** Approve an action. The House funds your Credit Account, which executes it and checks the resulting account health.
4. **Repay.** Sell or exit positions if needed, then repay the House in USDC using account proceeds or a wallet payment.
5. **Close.** Clear the debt and remaining app obligations, return collateral to your source wallet and release account control. Any remaining account assets belong to you.

## Try the demo

Borrow test USDC and trade MON in the [Kuru demo](https://termbook.xyz/app/kuru). The demo uses test assets on Monad testnet.

### Prepare your wallets

| What you need | Purpose |
| --- | --- |
| EVM wallet with test MON on Monad testnet | Borrowing, trading and repayment transaction fees |
| MON, ETH or SOL on a [supported source network](#supported-networks-and-apps), plus source gas | Collateral and lock transaction fees |
| Solana wallet on devnet, if using SOL | Locking and receiving your SOL collateral |
| Test USDC on Monad, if sale proceeds fall short | Covering remaining debt, interest or trading costs |

### Borrow, trade and repay

1. Connect your EVM wallet to **Monad testnet** and enter a **0.01 USDC** buy on Kuru.
2. Select **Use Termbook**, choose an offer and follow the collateral setup. Once the proof is accepted, review and confirm the buy.
3. Sell your MON, then use the modal's **Account** tab to repay and close the loan.

### Demo limits

- Automated offers are capped at **0.1 USDC**. Each trade also depends on available market liquidity and account health.
- Cross-chain locks and returns require source confirmations. Once credit is ready, further actions do not repeat the collateral lock.
- The chart uses Kuru mainnet reference prices. The order book and trades use the testnet market.

## Supported networks and apps

Lending and app execution run on **Monad testnet (`10143`)**. Supported collateral sources are:

| Source network | Collateral |
| --- | --- |
| Solana devnet | Native SOL |
| Base Sepolia (`84532`) | ETH, wrapped as WETH |
| Ethereum Sepolia (`11155111`) | ETH, wrapped as WETH |
| Monad testnet (`10143`) | Native MON |

**Kuru spot** supports market orders, limit orders, cancellation and keeper recovery. SDK interfaces also cover perps, vaults, staking and liquidity; each integration requires validation and admission.

See [network details](https://termbook.xyz/docs/getting-started/networks) and [deployment addresses](deployments/testnet.json). Mainnet lending is not activated.

## Integrate Termbook

Connect your app through the standard TypeScript interface, then embed the approved version with the SDK.

### 1. Validate your integration

Define account reads, approved actions and exit steps. Validate the deployed app's execution and recovery, register the passed validation ID and obtain activation and an `app_token`. Borrowers authorize their own transactions.

[Integration guide](https://termbook.xyz/docs/integrations/overview) · [Kuru implementation](server/src/kuru/integration.ts)

### 2. Install the SDK

```sh
npm install @termbook/sdk viem
```

### 3. Open the modal from your app

Pass a connected viem wallet client and active app token. The SDK resolves network and contract configuration; the modal handles credit setup and transaction approval.

This requests a **0.01 USDC** Kuru buy with **0.5% slippage**. Amounts use token units: USDC has six decimals, so `10_000n` is 0.01 USDC.

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

Call `open_credit` from **Use Termbook** after connecting to Monad testnet. The [SDK guide](https://termbook.xyz/docs/sdk/quickstart) covers account management and other actions.

## Architecture and security

House policies and verified account health determine borrowing capacity. These components enforce the loan lifecycle:

| Component | Role |
| --- | --- |
| Credit Account | Holds borrowed funds, purchased assets and positions; executes approved actions |
| House | Holds LP liquidity, sets loan terms and accounts for lending losses |
| Core and risk modules | Enforce borrowing, execution, valuation and recovery rules |
| Source vaults and programs | Hold collateral and process authorized returns or seizures |
| API, MongoDB and Envio indexer | Serve requests and track finalized activity and operation progress |
| Keepers | Relay proofs, update prices and perform authorized recovery |

Assets backing active debt have withdrawal restrictions. Approved keepers can unwind defaulted loans without borrower cooperation. LPs own House shares and withdraw under the vault's rules.

### Trust assumptions

- **Cross-chain proofs:** Wormhole's Guardian quorum attests to source events. Ethereum testnet uses five-block confirmations, Base uses safe blocks and Solana uses finalized state. Faster confirmation increases reorganisation risk.
- **Prices and recovery:** Loans depend on valid prices, executable exits and keepers with working services and transaction funds.
- **Upgrades:** Testnet governance has no execution delay; EVM and Solana upgrade authorities remain active. Kuru's testnet upgrade-monitor expiry checks are disabled. Code pins, permissions, price protection and health checks remain enforced.
- **Value routing:** Aurora repayment, LP funding and recovery routing is implemented; testnet routes are not admitted.

[Custody](https://termbook.xyz/docs/concepts/accounts) · [Health checks](https://termbook.xyz/docs/concepts/health) · [Trust and controls](https://termbook.xyz/docs/security/trust)

## Proof of execution

These receipts show steps from completed cross-chain loans, Kuru trading and keeper recovery:

| Flow | Transaction |
| --- | --- |
| Borrow on Monad against SOL on Solana devnet | [View borrow ↗](https://testnet.monadscan.com/tx/0x537e108909154102b6563f2d6fbc1d62d8d0cffe41a8c245784818db9900c1d1) |
| Borrow against Base ETH and trade on Kuru | [View action ↗](https://testnet.monadscan.com/tx/0x7b6ac72c56af437a00fdeda703964ce1364a864fdf930a55e28cc00d9ea3cf42) |
| Repay and close a Kuru loan | [Repay ↗](https://testnet.monadscan.com/tx/0x2d444cc662d691c976cef3cc2462ac61f96557d83ab868298f34b81aaf59c2c0) · [Close ↗](https://testnet.monadscan.com/tx/0x9f4ca9b38e5060260ededf61655f833c5ad48803b628f219b2cc5c8e83dee9c6) |
| Recover debt from a defaulted Kuru loan | [View recovery ↗](https://testnet.monadscan.com/tx/0x7db53a9736c3a01f8287005eaa763548e539b441a580bc415eb2b9a6fd6de8f5) |

[Complete execution records](README.md#proof-of-execution) include collateral return and closure. [Deployment configuration](deployments/testnet.json) lists contracts and admission settings.

## Run locally

Use **Node.js 22+**, **pnpm 10** and **Docker**. After cloning, run these commands from the repository root.

### 1. Install and build the services

```sh
git clone https://github.com/chigozzdevv/termbook.git
cd termbook
pnpm install --frozen-lockfile
pnpm --filter 'termbook-server...' build
```

### 2. Configure the environment

Create the root environment file:

```sh
cp -n server/.env.example .env
```

Follow the [operator guide](https://termbook.xyz/docs/operators/local) to configure deployed addresses, RPCs, collateral markets and signers. Add these local settings to `.env`:

```sh
PORT=3002
MONGO_URL=mongodb://127.0.0.1:27018/termbook_testnet_upgradeable?replicaSet=rs0&directConnection=true
REDIS_URL=redis://127.0.0.1:6380
RPC_BUDGET_REDIS_URL=redis://127.0.0.1:6380
PUBLIC_API_BASE=http://127.0.0.1:3002
PUBLIC_RPC_URL=http://127.0.0.1:3002/rpc
```

The client uses this local API by default. To change it, set `NEXT_PUBLIC_TERMBOOK_API_URL` in `client/.env.local`.

### 3. Start the databases

```sh
docker compose -f docker-compose.testnet.yml up -d
```

MongoDB data persists in its Docker volume. Keep signer files private.

### 4. Start the app

Run each process in a separate terminal:

```sh
# Terminal 1: API
node --env-file=.env server/dist/server.js

# Terminal 2: indexers and keepers
node --env-file=.env server/dist/worker.js

# Terminal 3: client
pnpm dev:client
```

Open [localhost:4178](http://127.0.0.1:4178). [Health](http://127.0.0.1:3002/health) checks the API; [readiness](http://127.0.0.1:3002/ready) checks finalized indexing and risk scans.

For deployment and upgrades, follow the [deployment guide](https://termbook.xyz/docs/operators/deployment).
