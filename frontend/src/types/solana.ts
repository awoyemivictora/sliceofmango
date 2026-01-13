export interface TokenAccount {
  pubkey: string;
  mint: string;
  owner: string;
  tokenAmount: {
    uiAmount: number;
    decimals: number;
    amount: string;
  };
  initialized: boolean;
  frozen: boolean;
  closeable: boolean;
  estimatedRent: number; // SOL amount
  isNFT?: boolean;
  isEmpty: boolean; // Add this
  programId: string;
}

export interface ReclaimResult {
  success: boolean;
  signature?: string;
  reclaimedSol: number;  // Changed from 'reclaimSol'
  closedAccounts: number;
  feePaid: number;
  error?: string;
}

export interface ReclaimEstimate {
  totalAccounts: number;
  reclaimableAccounts: number;
  estimatedTotalSol: number;  // Changed from 'estimatedTotalsol'
  feePercentage: number;
  feeAmount: number;
  netGain: number;
}

export const SOL_RENT_PER_ACCOUNT = 0.00203928; // Approximate rent per token account
export const FEE_PERCENTAGE = 0.05; // 5% platform fee
export const TX_FEE = 0.000005; // Approximate SOL per transaction
export const MAX_ACCOUNTS_PER_TX = 8; // Safe limit


