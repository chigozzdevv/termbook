export interface Order {
  id: string;
  intentId: string;
  kind: "request" | "credit";
  creditId: string | null;
  borrower: string;
  house: string | null;
  settlementAsset: string;
  limit: string;
  debt: string | null;
  aprBps: number | null;
  maturity: number | null;
  facility: string | null;
  status: string;
  collateral: {
    symbol: string;
    chain: { label: string; chainId?: number; namespace: string; reference?: string };
    asset: string;
    amount: string;
    decimals: number;
  };
  duration: number;
  createdAt: string;
  expiresAt: number | null;
  events: {
    event: string;
    blockNumber: number;
    transactionHash: string;
    logIndex: number;
    args: { creditId: string };
  }[];
}
