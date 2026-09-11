export type RepayArgs = {
  amount: bigint | "max";
  from: "credit_account" | "wallet" | "aurora_intents";
  source?: {
    chainId: number;
    asset: `0x${string}`;
    maxAmountIn: bigint;
    sourceRefund: `0x${string}`;
    monadRefund: `0x${string}`;
  };
};

export type RepayResult = {
  applied: bigint;
  remaining: bigint;
  status: "applied" | "partial" | "refunded" | "pending";
  tx?: `0x${string}`;
  operationId?: `0x${string}`;
};
