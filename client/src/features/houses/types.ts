export interface House {
  house: string;
  vault: string;
  manager: string;
  asset: string;
  active: boolean;
  paused: boolean;
  depositsOpen: boolean;
  unresolvedCreditImpairment: string;
  freeCash: string;
  queuedWithdrawalAssets: string;
  committedCash: string;
  drawnPrincipal: string;
  availableCash: string;
  totalAssets: string;
  totalShares: string;
  sharePrice: string;
  assetSymbol: string;
  decimals: number;
}
