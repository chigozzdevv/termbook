import type { CapabilityDefinition, UseCase } from "@termbook/schema";
import type { CollateralMarket } from "@termbook/schema";
import type { SourceLockWallet } from "../collateral/setup.js";

export type TxHash = `0x${string}`;

export type ContractWriteRequest = {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  gas?: bigint;
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
  actions?: CapabilityDefinition[];
  use_case?: UseCase;
  settlementAsset?: `0x${string}`;
  paymentWalletResolver?: (route: import("../settlement/payment-types.js").PaymentRoute) => Promise<import("../settlement/payment-types.js").PaymentSourceWallet>;
  sourceWalletResolver?: (market: CollateralMarket) => Promise<SourceLockWallet>;
};

export type ResolvedClientConfig = ClientConfig & {
  appToken: string;
  versionId?: `0x${string}`;
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
