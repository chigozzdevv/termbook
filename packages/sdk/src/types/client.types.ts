export type TxHash = `0x${string}`;

export type ContractWriteRequest = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account: `0x${string}`;
};

export type Wallet = {
  address: `0x${string}`;
  signTypedData: (payload: unknown) => Promise<TxHash>;
  signMessage?: (message: string) => Promise<TxHash>;
  signDigest?: (digest: TxHash) => Promise<TxHash>;
  writeContract?: (request: ContractWriteRequest) => Promise<TxHash>;
  waitForTransactionReceipt?: (hash: TxHash) => Promise<unknown>;
  getChainId?: () => Promise<number>;
};

export type ClientConfig = {
  appToken?: string;
  app_token?: string;
  wallet: Wallet;
  core?: `0x${string}`;
  rpcUrl?: string;
  rpc_url?: string;
  chainId?: number;
  chain_id?: number;
  apiBase?: string;
  accountFactory?: `0x${string}`;
  collateralVault?: `0x${string}`;
  houseVault?: `0x${string}`;
  settlementFactory?: `0x${string}`;
  appGateway?: `0x${string}`;
  integrationRegistry?: `0x${string}`;
  riskEngine?: `0x${string}`;
  confirmations?: number;
};

export type ResolvedClientConfig = ClientConfig & {
  appToken: string;
  core: `0x${string}`;
  rpcUrl: string;
  chainId: number;
};

export type ActivityEvent = {
  event: string;
  blockNumber?: bigint;
  transactionHash?: TxHash;
  logIndex?: bigint;
  args: Record<string, unknown>;
};

export type ActivityCallback = (events: ActivityEvent[]) => void;
export type Unsubscribe = () => void;
