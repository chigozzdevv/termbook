#!/bin/sh
set -e
pnpm build
pnpm test
pnpm typecheck
pnpm lint
FOUNDRY_VIA_IR=true forge test --root contracts/evm -j 1 "$@"
sh scripts/checks/contracts.sh
cargo test --manifest-path contracts/solana/Cargo.toml --locked
