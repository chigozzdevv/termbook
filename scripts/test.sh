#!/bin/sh
set -e
pnpm test
forge test --root contracts/evm
