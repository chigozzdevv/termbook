# Termbook

**Cross-chain credit for Monad apps, with less upfront collateral.**

Lock SOL, ETH or MON on a supported chain and borrow USDC to use in Monad apps. The assets and positions funded by your loan also help secure it, so you can borrow with less upfront collateral.

Collateral stays on its source chain. Borrowed funds and app assets stay in a **Credit Account** with enforced spending and repayment rules. **Houses** are lending pools funded by liquidity providers; their managers set loan terms and risk limits.

[App](https://termbook.xyz) · [Docs](https://termbook.xyz/docs) · [Demo video](https://youtu.be/DZBNAsH82t0) · [SDK](https://www.npmjs.com/package/@termbook/sdk)

## How it works

To borrow, use SOL on Solana devnet, ETH on Base Sepolia or Ethereum Sepolia, or MON on Monad testnet. Connect your Monad wallet, then follow the modal through these steps:

1. **Choose an offer.** Select **Use Termbook** in a supported app. Review the credit limit, interest rate, collateral requirement and repayment date.
2. **Lock collateral.** Approve the lock in your source wallet. Termbook verifies the collateral proof before making the credit available.
3. **Borrow and use the app.** Approve an action. The House funds your Credit Account, which executes it and checks the resulting account health.
4. **Repay.** Sell or exit positions if needed, then repay the House in USDC using account proceeds or a wallet payment.
5. **Close.** Clear the debt and remaining app obligations, return collateral to your source wallet and unlock your Credit Account. Any remaining account assets belong to you.

## Try the demo

Borrow test USDC and trade MON in the [Kuru demo](https://termbook.xyz/app/kuru). The demo uses test assets on Monad testnet.

### Prepare your wallets

| What you need | Purpose |
| --- | --- |
| EVM wallet with test MON on Monad testnet | Borrowing, trading and repayment transaction fees |
| MON, ETH or SOL on a [supported source network](#supported-networks-and-apps), plus the native token for transaction fees | Collateral and lock transaction fees |
| Solana wallet on devnet, if using SOL | Locking and receiving your SOL collateral |
| Test USDC on Monad, if sale proceeds fall short | Covering remaining debt, interest or trading costs |

### Borrow, trade and repay

1. Connect your EVM wallet to **Monad testnet** and enter a **0.01 USDC** buy on Kuru.
2. Select **Use Termbook**, choose an offer and follow the collateral setup. Once the proof is accepted, review and confirm the buy.
3. Sell your MON, then use the modal's **Account** tab to repay and close the loan.

### Demo limits

- **Demo loan limit:** The testnet House service issues offers for up to **0.1 USDC**. This is a demo setting; each House has its own lending policies. Trades also need enough market liquidity and a healthy account.
- **Collateral confirmation:** Borrowing starts after the lock is confirmed on the source chain and its proof is accepted on Monad. Collateral return also requires confirmation on the source chain.
- **Further draws:** The same collateral lock backs your active credit facility. Additional draws must fit its accepted credit limit, term and health rules.
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

This requests a **0.01 USDC** Kuru buy with **0.5% slippage**. Amounts use the token's smallest units: USDC has six decimals, so `10_000n` is 0.01 USDC.

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

- **Cross-chain proofs:** Wormhole's Guardian quorum attests to source events. The Sepolia route uses five-block confirmations, Base Sepolia uses safe blocks and Solana devnet uses finalized state. Faster confirmation increases reorganisation risk.
- **Prices and recovery:** Loans depend on valid prices, executable exits and keepers with working services and transaction funds.
- **Upgrades:** Testnet governance has no execution delay; EVM and Solana upgrade authorities remain active. Code pins, permissions, price protection and health checks remain enforced.
- **Value routing:** Aurora repayment, LP funding and recovery routing is implemented; testnet routes are not admitted.

[Custody](https://termbook.xyz/docs/concepts/accounts) · [Health checks](https://termbook.xyz/docs/concepts/health) · [Trust and controls](https://termbook.xyz/docs/security/trust)

## Proof of execution

These completed testnet runs cover borrowing, app execution, repayment, collateral return and recovery. Loan amounts reflect the House settings used for each run.

### Kuru: borrow, trade and repay

A MON-backed account borrowed **0.01 test USDC**, bought and sold MON, repaid the House and closed. Its collateral was returned and the Credit Account was unlocked.

| Step | Transaction |
| --- | --- |
| Accept offer | [0x36e2f03c…01090616](https://testnet.monadscan.com/tx/0x36e2f03cc87255ab01db86e7fd18321c4bc4674bd4a8bbbcab5fa2c701090616) |
| Lock MON | [0xcb284c62…bea37642](https://testnet.monadscan.com/tx/0xcb284c628ca1d60a986602d9b82fb0c0fab2634255f7c81e51f45b4fbea37642) |
| Borrow and buy | [0xecf743e3…8503a210](https://testnet.monadscan.com/tx/0xecf743e3493c5b0f844dc70a08a0410e69a71c61533ec711c15908db8503a210) |
| Sell | [0x84441892…b2a1186d](https://testnet.monadscan.com/tx/0x84441892d12431243999a574a69621d8082ee66cc8a7796904da2496b2a1186d) |
| Repay | [0x2d444cc6…af59c2c0](https://testnet.monadscan.com/tx/0x2d444cc662d691c976cef3cc2462ac61f96557d83ab868298f34b81aaf59c2c0) |
| Return collateral | [0x2efd0259…f111ec21](https://testnet.monadscan.com/tx/0x2efd0259dfe8af20902bec9f2512c58a414517b7aff26393818f9d8df111ec21) |
| Close | [0x9f4ca9b3…83dee9c6](https://testnet.monadscan.com/tx/0x9f4ca9b38e5060260ededf61655f833c5ad48803b628f219b2cc5c8e83dee9c6) |

### Cross-chain collateral loans

Sepolia ETH and Solana SOL loans used the reference asset app. The Base ETH loan used Kuru. Each finished with zero debt, returned collateral and an unlocked Credit Account.

All links below are **Monad receipts**. **Confirm return** records Monad accepting proof that collateral was returned on the source chain.

| Source collateral | Borrowed | Execution records |
| --- | --- | --- |
| Sepolia WETH | 1 test USDC | [Borrow ↗](https://testnet.monadscan.com/tx/0x9f967e0d3d740459a67e07348873cabde96e244c02797f6bc494aab7debe9931) · [Repay ↗](https://testnet.monadscan.com/tx/0x710f5343010dd71639acf9dc570d01a44b1f1cd8dfb35a5c6f7cbf0e25b4e8cb) · [Confirm return ↗](https://testnet.monadscan.com/tx/0x3c5427d3c62344540f9d8e8b0a987653d2c730ea0d7f0aa4144aabc13704f500) · [Close ↗](https://testnet.monadscan.com/tx/0xb7c618470cd6caaf68ba68ced05b5ae4e3d84128d603aea6f221af31d46bb644) |
| Solana devnet SOL | 1 test USDC | [Borrow ↗](https://testnet.monadscan.com/tx/0x537e108909154102b6563f2d6fbc1d62d8d0cffe41a8c245784818db9900c1d1) · [Repay ↗](https://testnet.monadscan.com/tx/0xb35af9d86ff4723b9d6a0fcedcc346dbee036270b8219cf9c48a11ba4e5d3780) · [Confirm return ↗](https://testnet.monadscan.com/tx/0x213aede7c8b58e1b109ed05f515c57448554f456c7cbbab2e4efe3b2b387d8f1) · [Close ↗](https://testnet.monadscan.com/tx/0xebd43f5d28b4cf14156ce5eae1dad7ff83c226156fdac47b8e78dbb8892f3f09) |
| Base Sepolia WETH | 0.1 test USDC | [Borrow ↗](https://testnet.monadscan.com/tx/0x7b6ac72c56af437a00fdeda703964ce1364a864fdf930a55e28cc00d9ea3cf42) · [Repay ↗](https://testnet.monadscan.com/tx/0x2ee3f9ee9e2770eac5fb41bdd2dd0eca85e7c555d73b33b09bf2d2ec34acf592) · [Confirm return ↗](https://testnet.monadscan.com/tx/0xa680608c65aa763a7448438528549a335988b02c8ebe9145f12e80aeddc4fa0c) · [Close ↗](https://testnet.monadscan.com/tx/0x8e1097403527b87698f5a1d309ada5fd8e87858f1e3e32239392347bdbe7322f) |

### Keeper recovery

A Base ETH-backed loan put **0.01 test USDC** into a Kuru limit order. Before default, the borrower paid **0.000001 USDC** for venue rounding. An approved keeper cancelled the order, withdrew the refund and recovered the remaining **0.009999 USDC**. Collateral was returned and the account closed with zero debt.

| Step | Transaction |
| --- | --- |
| Keeper recovery step | [0xa85e36b3…2500e496](https://testnet.monadscan.com/tx/0xa85e36b339db329c5475bbe4a70b6bb27365d57db96b5c8f8dccf4b32500e496) |
| Recover remaining debt | [0x7db53a97…fd6de8f5](https://testnet.monadscan.com/tx/0x7db53a9736c3a01f8287005eaa763548e539b441a580bc415eb2b9a6fd6de8f5) |
| Confirm WETH return | [0xd8b1c723…9a9fef75](https://testnet.monadscan.com/tx/0xd8b1c723489e3ecd1c359322f4b81aa8f7760a15453f757133bc3bb49a9fef75) |
| Finalize recovery | [0x532551c6…7e86f8a8](https://testnet.monadscan.com/tx/0x532551c64b3f75400be498ef963d00b6d5d3d603c01b655cae14117f7e86f8a8) |

[Deployment configuration](deployments/testnet.json) lists the contract addresses and Kuru admission settings.

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
