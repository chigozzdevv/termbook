export function requiredDraw(requiredInput: bigint, freeAssets: bigint): bigint {
  if (requiredInput < 0n) throw new Error("param-invalid");
  if (freeAssets < 0n) throw new Error("param-invalid");
  if (freeAssets >= requiredInput) return 0n;
  return requiredInput - freeAssets;
}

export function fundingNeed(
  margin: bigint,
  financedCosts: bigint,
  freeAssets: bigint,
): { need: bigint; draw: bigint } {
  if (margin < 0n || financedCosts < 0n) throw new Error("param-invalid");
  const need = margin + financedCosts;
  return { need, draw: requiredDraw(need, freeAssets) };
}

export function checkCapacity(
  draw: bigint,
  limit: bigint,
  used: bigint,
  revolving: boolean,
  debt: bigint,
): void {
  if (draw < 0n || limit < 0n || used < 0n || debt < 0n) throw new Error("param-invalid");
  const capacity = revolving ? (debt > limit ? 0n : limit - debt) : (used > limit ? 0n : limit - used);
  if (draw > capacity) throw new Error("draw-capped");
}
