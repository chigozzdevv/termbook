#!/bin/sh
set -eu

usage() {
  echo "usage: scripts/deploy.sh {protocol|routing|source|ethereum-beacon-client|ethereum-verifier|native-collateral|collateral-health-reader|app-health-reader}" >&2
  exit 2
}

same() {
  [ "$(printf '%s' "$1" | LC_ALL=C tr 'A-F' 'a-f')" = "$(printf '%s' "$2" | LC_ALL=C tr 'A-F' 'a-f')" ]
}

fail() {
  echo "$1" >&2
  exit 1
}

check_monad_deployment() {
  monad_rpc=$1
  : "${MONAD_FACTORY_ADDRESS:?MONAD_FACTORY_ADDRESS is required}"
  : "${MONAD_FACTORY_CODE_HASH:?MONAD_FACTORY_CODE_HASH is required}"
  : "${MONAD_CORE_ADDRESS:?MONAD_CORE_ADDRESS is required}"
  : "${MONAD_CORE_CODE_HASH:?MONAD_CORE_CODE_HASH is required}"
  : "${HOUSE_VAULT_ADDRESS:?HOUSE_VAULT_ADDRESS is required}"
  : "${HOUSE_VAULT_CODE_HASH:?HOUSE_VAULT_CODE_HASH is required}"
  : "${GOVERNANCE_ADDRESS:?GOVERNANCE_ADDRESS is required}"
  : "${SETTLEMENT_ASSET:?SETTLEMENT_ASSET is required}"
  [ "$(cast chain-id --rpc-url "$monad_rpc")" = "$MONAD_CHAIN_ID" ] || fail "Monad RPC chain mismatch"
  finalized_height=$(cast block-number finalized --rpc-url "$monad_rpc")
  [ "$finalized_height" -ge 3 ] || fail "Monad verified height unavailable"
  monad_read_block=$((finalized_height - 3))
  same "$(cast codehash "$MONAD_FACTORY_ADDRESS" --block "$monad_read_block" --rpc-url "$monad_rpc")" "$MONAD_FACTORY_CODE_HASH" || fail "Monad factory code hash mismatch"
  same "$(cast codehash "$MONAD_CORE_ADDRESS" --block "$monad_read_block" --rpc-url "$monad_rpc")" "$MONAD_CORE_CODE_HASH" || fail "Monad Core code hash mismatch"
  same "$(cast codehash "$HOUSE_VAULT_ADDRESS" --block "$monad_read_block" --rpc-url "$monad_rpc")" "$HOUSE_VAULT_CODE_HASH" || fail "HouseVault code hash mismatch"
  same "$(cast call "$MONAD_FACTORY_ADDRESS" 'governance()(address)' --block "$monad_read_block" --rpc-url "$monad_rpc")" "$GOVERNANCE_ADDRESS" || fail "Monad factory governance mismatch"
  same "$(cast call "$HOUSE_VAULT_ADDRESS" 'core()(address)' --block "$monad_read_block" --rpc-url "$monad_rpc")" "$MONAD_CORE_ADDRESS" || fail "HouseVault Core binding mismatch"
  same "$(cast call "$HOUSE_VAULT_ADDRESS" 'inboxFactory()(address)' --block "$monad_read_block" --rpc-url "$monad_rpc")" "$MONAD_FACTORY_ADDRESS" || fail "HouseVault factory binding mismatch"
  same "$(cast call "$HOUSE_VAULT_ADDRESS" 'asset()(address)' --block "$monad_read_block" --rpc-url "$monad_rpc")" "$SETTLEMENT_ASSET" || fail "HouseVault settlement asset mismatch"
}

[ "$#" -eq 1 ] || usage
: "${RPC_URL:?RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
: "${MONAD_CHAIN_ID:?MONAD_CHAIN_ID is required}"
case "$MONAD_CHAIN_ID" in
  143|10143) ;;
  *) echo "Monad mainnet or testnet chain ID required" >&2; exit 1 ;;
esac

case "$1" in
  protocol|routing|ethereum-beacon-client|ethereum-verifier|native-collateral|collateral-health-reader|app-health-reader)
    foundry_version=$(forge --version)
    if ! printf '%s\n' "$foundry_version" | awk -F '[ .-]' 'NR == 1 { exit !($3 > 1 || ($3 == 1 && $4 >= 8)) }'; then
      echo "Foundry 1.8 or newer is required for Monad deployment" >&2
      exit 1
    fi
    ;;
  source)
    : "${SOURCE_CHAIN_ID:?SOURCE_CHAIN_ID is required}"
    [ "$SOURCE_CHAIN_ID" = 1 ] || { echo "Ethereum mainnet source required" >&2; exit 1; }
    ;;
  *) usage ;;
esac

if [ "$1" = source ] || [ "$1" = ethereum-beacon-client ] || [ "$1" = ethereum-verifier ]; then
  [ "$MONAD_CHAIN_ID" = 143 ] || { echo "Monad mainnet is required for Ethereum mainnet collateral" >&2; exit 1; }
fi

if [ "$1" = ethereum-beacon-client ]; then
  : "${ETHEREUM_CHECKPOINT_FILE:?ETHEREUM_CHECKPOINT_FILE is required}"
  : "${ETHEREUM_CHECKPOINT_GOVERNANCE:?ETHEREUM_CHECKPOINT_GOVERNANCE is required}"
  [ -f "$ETHEREUM_CHECKPOINT_FILE" ] || fail "Ethereum checkpoint file missing"
fi

if [ "$1" = source ]; then
  : "${MONAD_RPC_URL:?MONAD_RPC_URL is required}"
  : "${SOURCE_GOVERNANCE:?SOURCE_GOVERNANCE is required}"
  check_monad_deployment "$MONAD_RPC_URL"
  [ "$(cast code "$SOURCE_GOVERNANCE" --block finalized --rpc-url "$RPC_URL")" != 0x ] || fail "Ethereum governance contract missing"
fi

if [ "$1" = ethereum-verifier ]; then
  check_monad_deployment "$RPC_URL"
  : "${SOURCE_RPC_URL:?SOURCE_RPC_URL is required}"
  : "${SOURCE_VAULT_ADDRESS:?SOURCE_VAULT_ADDRESS is required}"
  : "${SOURCE_VAULT_CODE_HASH:?SOURCE_VAULT_CODE_HASH is required}"
  : "${SOURCE_CONTROLLER_ADDRESS:?SOURCE_CONTROLLER_ADDRESS is required}"
  : "${SOURCE_CONTROLLER_CODE_HASH:?SOURCE_CONTROLLER_CODE_HASH is required}"
  : "${SOURCE_RECOVERY_VAULT_ADDRESS:?SOURCE_RECOVERY_VAULT_ADDRESS is required}"
  : "${COLLATERAL_ASSET:?COLLATERAL_ASSET is required}"
  : "${MONAD_CORE_ADDRESS:?MONAD_CORE_ADDRESS is required}"
  [ "$(cast chain-id --rpc-url "$SOURCE_RPC_URL")" = 1 ] || { echo "Ethereum source RPC required" >&2; exit 1; }
  same "$(cast codehash "$SOURCE_VAULT_ADDRESS" --block finalized --rpc-url "$SOURCE_RPC_URL")" "$SOURCE_VAULT_CODE_HASH" || { echo "source vault code hash mismatch" >&2; exit 1; }
  same "$(cast codehash "$SOURCE_CONTROLLER_ADDRESS" --block finalized --rpc-url "$SOURCE_RPC_URL")" "$SOURCE_CONTROLLER_CODE_HASH" || { echo "source controller code hash mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_CONTROLLER_ADDRESS" 'vault()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$SOURCE_VAULT_ADDRESS" || { echo "source vault binding mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_CONTROLLER_ADDRESS" 'recoveryVault()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$SOURCE_RECOVERY_VAULT_ADDRESS" || { echo "source recovery binding mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_CONTROLLER_ADDRESS" 'monadCore()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$MONAD_CORE_ADDRESS" || { echo "Monad Core binding mismatch" >&2; exit 1; }
  [ "$(cast to-dec "$(cast call "$SOURCE_CONTROLLER_ADDRESS" 'monadChain()' --block finalized --rpc-url "$SOURCE_RPC_URL")")" = "$MONAD_CHAIN_ID" ] || { echo "Monad chain binding mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_VAULT_ADDRESS" 'core()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$SOURCE_CONTROLLER_ADDRESS" || { echo "source vault controller mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_VAULT_ADDRESS" 'asset()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$COLLATERAL_ASSET" || { echo "source collateral asset mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_RECOVERY_VAULT_ADDRESS" 'controller()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$SOURCE_CONTROLLER_ADDRESS" || { echo "source recovery controller mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_RECOVERY_VAULT_ADDRESS" 'asset()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$COLLATERAL_ASSET" || { echo "source recovery asset mismatch" >&2; exit 1; }
  same "$(cast call "$SOURCE_RECOVERY_VAULT_ADDRESS" 'monadFactory()(address)' --block finalized --rpc-url "$SOURCE_RPC_URL")" "$MONAD_FACTORY_ADDRESS" || fail "source recovery factory mismatch"
fi

case "$1" in
  protocol) script=deploy-protocol.s.sol ;;
  routing) script=deploy-routing.s.sol ;;
  source) script=deploy-source.s.sol ;;
  ethereum-beacon-client) script=deploy-ethereum-beacon-client.s.sol ;;
  ethereum-verifier) script=deploy-ethereum-verifier.s.sol ;;
  native-collateral) script=deploy-native-collateral.s.sol ;;
  collateral-health-reader) script=deploy-collateral-health-reader.s.sol ;;
  app-health-reader) script=deploy-app-health-reader.s.sol ;;
esac

if [ "$1" = source ]; then
  forge script "script/$script" --root contracts/evm --rpc-url "$RPC_URL" --broadcast
else
  forge script "script/$script" --root contracts/evm --rpc-url "$RPC_URL" --network monad --broadcast
fi
