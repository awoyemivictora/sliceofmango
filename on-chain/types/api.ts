export interface CreateTokenRequest {
    metadata: {
        name: string;
        symbol: string;
        description?: string;
        image?: string;
        uri: string;
        attributes?: Array<{
            trait_type: string;
            value: string;
        }>;
    };
    user_wallet: string;
    encrypted_private_key?: string;
    creator_override?: string;
    use_jito: boolean;
    initial_sol_reserves?: number;  // Default 1 SOL
    slippage_bps?: number;  // Default 5% (500)
}

export interface BuyRequest {
    action: 'buy' | 'atomic_buy' | 'execute_bot_buys';
    mint_address: string;
    user_wallet: string;
    amount_sol: number;
    bot_wallets?: Array<{
        public_key: string;
        buy_amount: number;
    }>;
    use_jito: boolean;
    slippage_bps?: number;  // Default 5% (500)
}

export interface SellRequest {
    mint_address: string;
    user_wallet: string;
    bot_wallets?: Array<{
        public_key: string;
        sell_percentage?: number;   // Default 100%
    }>;
    use_jito: boolean;
    slippage_bps?: number;  // Default 5% (500)
    sell_strategy?: 'immediate' | 'price_target' | 'volume_based';
}

export interface FundBotsRequest {
    bot_wallets: Array<{
        public_key: string;
        amount_sol: number;
    }>;
    user_wallet: string;
    use_jito: boolean;
}

export interface AtomicLaunchRequest {
    metadata: {
        name: string;
        symbol: string;
        uri: string;
        description?: string;
    };
    user_wallet: string;
    creator_buy_amount: number;
    bot_wallets: Array<{
        public_key: string;
        buy_amount: number; // Amount each bot should spend
        is_pre_funded: boolean; // Whether bot already has SOL
        pre_funded_amount?: number; // How much SOL bot already has
    }>;
    use_jito: boolean;
    atomic_bundle: boolean;
    creator_override?: string;
    slippage_bps?: number;
}

export interface ExecuteBotBuysRequest {
    action: 'execute_bot_buys';
    mint_address: string;
    user_wallet: string;
    bot_wallets: Array<{
        public_key: string;
        buy_amount: number;
    }>;
    use_jito: boolean;
    slippage_bps?: number;
    auto_fund?: boolean;
}

// Also add the new interface for complete launch bundle
export interface CompleteLaunchBundleRequest {
    user_wallet: string;
    metadata: {
        name: string;
        symbol: string;
        uri: string;
        description?: string;
    };
    creator_buy_amount: number;
    bot_buys: Array<{
        public_key: string;
        amount_sol: number;
    }>;
    use_jito?: boolean;
    slippage_bps?: number;
}

export interface EstimateCostRequest {
    action: 'create_token' | 'buy' | 'sell' | 'fund_bots' | 'atomic_launch' | 'execute_bot_buys';
    config: CreateTokenRequest | BuyRequest | SellRequest | FundBotsRequest | AtomicLaunchRequest | ExecuteBotBuysRequest;
}

export interface APIResponse {
    success: boolean;
    data?: any;
    error?: string;
    estimated_cost?: number;
    signature?: string;
    bundle_id?: string;
    mint_address?: string;
    timestamp: string;
    signatures?: string[];  // For multiple transactions
}






