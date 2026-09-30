import { parseAbi, parseEventLogs, type Hex } from "viem";
import { houseVaultAbi } from "@termbook/bindings";
import type { TermbookClient } from "../client/client.js";
import type { TxHash } from "../types/client.types.js";
const factoryAbi = parseAbi([
  "function inboxOf(bytes32) view returns (address)",
  "function recoveryOperation(bytes32) view returns (bool)",
  "function recoverySettled(bytes32) view returns (bool)",
  "function recoveryCancelled(bytes32) view returns (bool)",
  "function acceptedRecoveryShortfall(bytes32) view returns (uint256)",
  "function RECOVERY_SHORTFALL_DELAY() view returns (uint256)",
  "event RecoveryShortfallAccepted(bytes32 indexed operationId,bytes32 indexed creditId,uint256 accounted,uint256 shortfall)",
]);
const inboxAbi = parseAbi([
  "function vault() view returns (address)",
  "function token() view returns (address)",
  "function creditId() view returns (bytes32)",
  "function deadline() view returns (uint256)",
  "function minOut() view returns (uint256)",
  "function applied() view returns (uint256)",
  "function refunded() view returns (uint256)",
  "function untrackedApplied() view returns (uint256)",
  "function untrackedRefunded() view returns (uint256)",
  "function available() view returns (uint256)",
]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const coreAbi = parseAbi([
  "function creditVault(bytes32) view returns (address)",
  "function creditDebt(bytes32) view returns (uint256)",
]);
export type RecoveryOperationView = {
  operationId: Hex;
  factory: Hex;
  inbox: Hex;
  creditId: Hex;
  debt: bigint;
  deadline: bigint;
  minimum: bigint;
  accounted: bigint;
  available: bigint;
  balance: bigint;
  shortfall: bigint;
  acceptedShortfall: bigint;
  settled: boolean;
  cancelled: boolean;
  manager: Hex;
  canAcceptShortfall: boolean;
  blockNumber: bigint;
  blockHash: Hex;
};
export async function readRecoveryOperation(
  client: TermbookClient,
  house: Hex,
  operationId: Hex,
): Promise<RecoveryOperationView> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(operationId) || /^0x0{64}$/i.test(operationId))
    throw new Error("param-invalid");
  await client.ready();
  const chain = client.rpc.client;
  if ((await chain.getChainId()) !== client.config.chainId) throw new Error("chain-mismatch");
  const block = await chain.getBlock({ blockTag: "finalized" });
  const read = <T>(
    address: Hex,
    abi: readonly unknown[],
    name: string,
    args: readonly unknown[] = [],
  ) => client.rpc.read<T>(address, abi, name, args, block.number);
  const [factory, core, asset, manager] = await Promise.all(
    ["inboxFactory", "core", "asset", "manager"].map((name) =>
      read<Hex>(house, houseVaultAbi, name),
    ),
  );
  if (
    !factory ||
    !core ||
    !asset ||
    !manager ||
    core.toLowerCase() !== client.config.core.toLowerCase()
  )
    throw new Error("recovery-house-mismatch");
  const [inbox, recovery, settled, cancelled, acceptedShortfall, delay] = await Promise.all([
    read<Hex>(factory, factoryAbi, "inboxOf", [operationId]),
    read<boolean>(factory, factoryAbi, "recoveryOperation", [operationId]),
    read<boolean>(factory, factoryAbi, "recoverySettled", [operationId]),
    read<boolean>(factory, factoryAbi, "recoveryCancelled", [operationId]),
    read<bigint>(factory, factoryAbi, "acceptedRecoveryShortfall", [operationId]),
    read<bigint>(factory, factoryAbi, "RECOVERY_SHORTFALL_DELAY"),
  ]);
  if (!recovery || /^0x0{40}$/i.test(inbox)) throw new Error("recovery-operation-not-found");
  const [
    vault,
    token,
    creditId,
    deadline,
    minimum,
    applied,
    refunded,
    untrackedApplied,
    untrackedRefunded,
    available,
    balance,
  ] = await Promise.all([
    read<Hex>(inbox, inboxAbi, "vault"),
    read<Hex>(inbox, inboxAbi, "token"),
    read<Hex>(inbox, inboxAbi, "creditId"),
    read<bigint>(inbox, inboxAbi, "deadline"),
    read<bigint>(inbox, inboxAbi, "minOut"),
    read<bigint>(inbox, inboxAbi, "applied"),
    read<bigint>(inbox, inboxAbi, "refunded"),
    read<bigint>(inbox, inboxAbi, "untrackedApplied"),
    read<bigint>(inbox, inboxAbi, "untrackedRefunded"),
    read<bigint>(inbox, inboxAbi, "available"),
    read<bigint>(asset, tokenAbi, "balanceOf", [inbox]),
  ]);
  const [creditVault, debt] = await Promise.all([
    read<Hex>(core, coreAbi, "creditVault", [creditId]),
    read<bigint>(core, coreAbi, "creditDebt", [creditId]),
  ]);
  if (
    vault.toLowerCase() !== house.toLowerCase() ||
    token.toLowerCase() !== asset.toLowerCase() ||
    creditVault.toLowerCase() !== house.toLowerCase()
  )
    throw new Error("recovery-house-mismatch");
  const accounted = applied + refunded + untrackedApplied + untrackedRefunded,
    shortfall = minimum > accounted ? minimum - accounted : 0n;
  return {
    operationId,
    factory,
    inbox,
    creditId,
    debt,
    deadline,
    minimum,
    accounted,
    available,
    balance,
    shortfall,
    acceptedShortfall,
    settled,
    cancelled,
    manager,
    canAcceptShortfall:
      !settled &&
      shortfall > 0n &&
      available === 0n &&
      balance === 0n &&
      block.timestamp > deadline + delay,
    blockNumber: block.number,
    blockHash: block.hash,
  };
}
export async function acceptRecoveryShortfall(
  client: TermbookClient,
  house: Hex,
  input: { operation_id: Hex; expected_accounted: bigint },
): Promise<{ tx: TxHash; accounted: bigint; shortfall: bigint }> {
  if (input.expected_accounted < 0n) throw new Error("param-invalid");
  const operation = await readRecoveryOperation(client, house, input.operation_id);
  if (operation.manager.toLowerCase() !== client.signer.address().toLowerCase())
    throw new Error("recovery-house-manager-required");
  if (!operation.canAcceptShortfall || input.expected_accounted !== operation.accounted)
    throw new Error("recovery-shortfall-review-changed");
  const tx = await client.rpc.write(house, houseVaultAbi, "acceptRecoveryShortfall", [
    input.operation_id,
    input.expected_accounted,
  ]);
  const receipt = await client.rpc.wait(tx);
  const events = parseEventLogs({
    abi: factoryAbi,
    eventName: "RecoveryShortfallAccepted",
    logs: receipt.logs.filter(
      (log) => log.address.toLowerCase() === operation.factory.toLowerCase(),
    ),
  });
  const event = events.find(
    (event) => event.args.operationId.toLowerCase() === input.operation_id.toLowerCase(),
  );
  if (
    !event ||
    event.args.accounted !== input.expected_accounted ||
    event.args.shortfall !== operation.shortfall
  )
    throw new Error("recovery-shortfall-receipt-mismatch");
  return { tx, accounted: event.args.accounted, shortfall: event.args.shortfall };
}
