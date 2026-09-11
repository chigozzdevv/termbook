import type { ChainEvent } from "./monad.client.js";

export function isReorg(a: ChainEvent, b: ChainEvent): boolean {
  if (a.name !== b.name || a.block !== b.block) return false;
  if (a.blockHash && b.blockHash) return a.blockHash !== b.blockHash;
  return a.tx !== b.tx || a.logIndex !== b.logIndex;
}
