export const errorCodes = [
  "offer-invalid",
  "liquidity-short",
  "proof-invalid",
  "permission-denied",
  "capability-denied",
  "param-invalid",
  "recipient-invalid",
  "nonce-used",
  "auth-expired",
  "draw-capped",
  "health-low",
  "settle-failed",
  "recovery-blocked",
  "release-denied",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class TermbookError extends Error {
  code: ErrorCode;
  next: string;

  constructor(code: ErrorCode, reason: string, next: string) {
    super(reason);
    this.code = code;
    this.next = next;
  }
}
