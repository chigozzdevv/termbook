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

export type CollateralChangeCheckpoint = {
  chainId: number;
  core: `0x${string}`;
  creditId: `0x${string}`;
  operation: "add" | "withdraw";
  amount: string;
  authorizationTx: `0x${string}`;
  actionHash?: `0x${string}`;
  sourceTx?: string;
  confirmationTx?: `0x${string}`;
  stage: "submitted" | "authorized" | "source_submitted" | "complete";
};
export type CollateralChangeOptions = {
  checkpoint?: CollateralChangeCheckpoint;
  sourceWallet?: import("../collateral/setup.js").SourceLockWallet;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (checkpoint: CollateralChangeCheckpoint) => void | Promise<void>;
};
