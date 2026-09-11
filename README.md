# Termbook

Credit inside applications on Monad. Borrowers lock collateral on a supported
chain and draw funds from a House through a restricted Credit Account.

See `termbook.md` for the required behavior specification.

## Layout

- `contracts/` Foundry Solidity protocol
- `packages/bindings/` generated contract ABIs and deployments
- `packages/schema/` shared request and response schemas
- `packages/sdk/` borrower and LP client
- `server/` off-chain indexer and coordinator, no custody authority
- `scripts/` repo automation

## Commands

```sh
pnpm install
pnpm build
pnpm lint
pnpm typecheck
pnpm test
forge test
```
