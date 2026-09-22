export type CollateralArgs = {
  amount: bigint;
  asset?: `0x${string}`;
  owner?: `0x${string}`;
  recipient?: `0x${string}`;
  sourceChain?: number;
  deadline?: number;
  nonce?: bigint;
  lockId?: `0x${string}`;
  header?: `0x${string}`;
  proof?: `0x${string}`;
};
