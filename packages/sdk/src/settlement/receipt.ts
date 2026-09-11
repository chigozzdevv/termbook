export type ReceiptView = { received: bigint; applied: bigint; refunded: bigint };

export function unconsumed(r: ReceiptView): bigint {
  if (r.received < 0n || r.applied < 0n || r.refunded < 0n) throw new Error("param-invalid");
  if (r.applied + r.refunded > r.received) throw new Error("settle-failed");
  return r.received - r.applied - r.refunded;
}

export function reportShortfall(
  requested: bigint,
  applied: bigint,
): { shortfall: bigint; partial: boolean } {
  if (requested < 0n || applied < 0n) throw new Error("param-invalid");
  if (applied > requested) throw new Error("settle-failed");
  return { shortfall: requested - applied, partial: applied < requested };
}
