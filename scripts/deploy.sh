#!/bin/sh
set -e
set -u
: "${RPC_URL:?RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
forge script contracts/script/deploy-protocol.s.sol --rpc-url "$RPC_URL" --broadcast
forge script contracts/script/deploy-routing.s.sol --rpc-url "$RPC_URL" --broadcast
forge script contracts/script/deploy-source.s.sol --rpc-url "$RPC_URL" --broadcast
