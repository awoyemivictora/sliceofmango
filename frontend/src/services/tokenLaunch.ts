// services/tokenLaunch.ts
import { apiService } from './api';

export interface LaunchConfig {
  // Core token info
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  imageUrl: string;
  creatorWallet: string;
  creatorPrivateKey?: string;
  
  // Bot configuration
  botCount: number;
  botWalletBuyAmount: number;
  creatorBuyAmount: number;
  
  // Strategy
  targetProfitPercentage: number;
  sellTiming: 'volume_based' | 'time_based' | 'price_target' | 'immediate';
  sellVolumeTrigger: number;
  sellTimeTrigger: number;
  sellPriceTarget: number;
  
  // AI Metadata
  useAIForMetadata: boolean;
  metadataStyle: 'professional' | 'meme' | 'community' | 'ai-generated' | 'gaming';
  metadataKeywords: string;
  useDalle: boolean;
  
  // Advanced settings
  initialSolReserves?: number;
  useJitoBundle?: boolean;
  priority?: number;
  botSpread?: string;
  
  // Additional fields that might be needed
  customMetadata?: any;
  
  // ADD these fields that are used in the backend conversion
  metadata_style?: string; // Optional - for backend
  use_jito_bundle?: boolean; // Optional - for backend
  
  // Add atomicMode to fix the error
  atomicMode?: boolean;
}

export interface BotArmyWallet {
  publicKey: string;
  privateKey: string;
  balance: number;
  isFunded: boolean;
  buyAmount: number;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{
    trait_type: string;
    value: string;
  }>;
  image_prompt?: string;
  created_at: string;
}

export interface LaunchResult {
  success: boolean;
  mintAddress: string;
  creatorTransaction: string;
  botBuyBundleId?: string;
  botSellBundleId?: string;
  totalProfit: number;
  roi: number;
  duration: number;
  error?: string;
}

export interface FrontendLaunchStatus {
  phase: 'setup' | 'metadata' | 'creating' | 'funding' | 'ready' | 'launching' | 'monitoring' | 'selling' | 'complete' | 'failed';
  progress: number;
  message: string;
  currentStep: string;
  estimatedTimeRemaining: number;
}

export interface BotWalletsTableProps {
  botWallets: BotWallet[];
  botArmy?: any[];
}

export interface LaunchStatus {
  launch_id: string;
  status: string;
  progress: number;
  message: string;
  current_step: string;
  started_at: string;
  updated_at: string;
  estimated_time_remaining: number;
  mint_address?: string;
  success?: boolean;
  total_profit?: number;
  roi?: number;
  duration?: number;
  
  // Add these to fix the errors
  creator_tx_hash?: string;
  bot_buy_bundle_id?: string;
  bot_sell_bundle_id?: string;
}

export interface BotWallet {
  public_key: string;
  status: string;
  funded_amount: number;
  buy_amount: number;
  current_balance: number;
  token_balance: number;
  profit: number;
  roi: number;
  buy_tx_hash?: string;
  sell_tx_hash?: string;
  launch_id?: string;
  created_at: string;
  last_updated: string;
  
  // Add these for pre-funding
  is_pre_funded?: boolean;
  pre_funded_amount?: number;
  pre_funded_tx_hash?: string;
  
  // Also add these from your component's BotWallet interface
  id: string | number;
  private_key_token: string;
}

export interface LaunchHistoryItem {
  launch_id: string;
  token_name?: string;
  token_symbol?: string;
  mint_address?: string;
  status: string;
  success: boolean;
  total_profit: number;
  roi: number;
  duration: number;
  started_at: string;
  completed_at?: string;
}

export interface CostEstimation {
  total_cost: number;
  recommended_balance: number;
  cost_breakdown: {
    bot_wallets: number;
    creator_buy: number;
    transaction_fees: number;
    total: number;
  };
}

// Backend-specific interfaces for API calls
export interface BackendLaunchConfig {
  use_ai_metadata?: boolean;
  custom_metadata?: any;
  bot_count?: number;
  creator_buy_amount?: number;
  bot_buy_amount?: number;
  sell_strategy_type?: 'volume_based' | 'time_based' | 'price_target' | 'immediate';
  sell_volume_target?: number;
  sell_price_target?: number;
  sell_time_minutes?: number;
  metadata_style?: string;
  use_jito_bundle?: boolean;
  priority?: number;
}

export interface PreFundRequest {
  bot_count: number;
  pre_fund_amount: number;  // Amount to pre-fund each bot
  buy_amount: number; // Intended buy amount for each bot
}

export interface PreFundResponse {
  success: boolean;
  message: string;
  pre_funded_count: number;
  total_pre_funded: number;
  signatures: string[];
  bundle_id?: string;
}

export interface BotWalletStatus {
  id: number;
  public_key: string;
  status: string;
  pre_funded_amount: number | null;
  funded_amount: number | null;
  current_balance: number;
  is_pre_funded: boolean;
  pre_funded_tx_hash: string | null;
  created_at: string;
  last_updated: string;
}

export interface AtomicLaunchRequest {
  launch_config: LaunchConfig;
  use_pre_funded: boolean;
  max_bots?: number;
  atomic_bundle: boolean;
}

export interface AtomicLaunchResponse {
  success: boolean;
  launch_id: string;
  atomic_bundle: boolean;
  total_bots_used: number;
  total_pre_funded: number;
  estimated_cost: number;
  message: string;
  error?: string; 
}

class TokenLaunchService {
  // Helper method to convert frontend config to backend format
  private convertToBackendConfig(config: Partial<LaunchConfig>): BackendLaunchConfig {
    return {
      use_ai_metadata: config.useAIForMetadata ?? true,
      custom_metadata: config.customMetadata,
      bot_count: config.botCount ?? 10,
      creator_buy_amount: config.creatorBuyAmount ?? 0.5,
      bot_buy_amount: config.botWalletBuyAmount ?? 0.1,
      
      // FIXED: Keep the value as-is (already lowercase with underscores)
      sell_strategy_type: config.sellTiming || 'volume_based',
      
      // Make sure these values are set properly
      sell_volume_target: config.sellVolumeTrigger || (config.sellTiming === 'volume_based' ? 5.0 : 0),
      sell_price_target: config.sellPriceTarget || (config.sellTiming === 'price_target' ? 2.0 : 0),
      sell_time_minutes: config.sellTimeTrigger || (config.sellTiming === 'time_based' ? 5 : 0),
      
      metadata_style: config.metadataStyle ?? 'ai-generated',
      use_jito_bundle: config.useJitoBundle ?? true,
      priority: config.priority ?? 10,
    };
  }

  // Create a new launch
  async createLaunch(config: Partial<LaunchConfig>) {
    const backendConfig = this.convertToBackendConfig(config);
    
    const launchRequest = {
      config: backendConfig,
      schedule_for: null,
      priority: config.priority ?? 10,
    };

    return await apiService.request('/creators/token/launch', {
      method: 'POST',
      body: JSON.stringify(launchRequest),
    });
  }

  // Quick launch with minimal config
  async quickLaunch(params: {
    botCount: number;
    creatorBuyAmount: number;
    botBuyAmount: number;
    style: string;
    keywords: string;
    useDalle: boolean;
    sellStrategyType: 'volume_based' | 'time_based' | 'price_target' | 'immediate'; // CHANGE TO LOWERCASE
    sellVolumeTarget?: number;
    sellPriceTarget?: number;
    sellTimeMinutes?: number;
  }) {
    return await apiService.request('/creators/token/quick-launch', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // Get launch status
  async getLaunchStatus(launchId: string): Promise<LaunchStatus> {
    return await apiService.request(`/creators/token/launch/${launchId}/status`);
  }

  // Get launch history
  async getLaunchHistory(params?: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<{
    launches: LaunchHistoryItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.offset) query.set('offset', params.offset.toString());
    if (params?.status) query.set('status', params.status);
    
    return await apiService.request(`/creators/token/launches?${query}`);
  }

  // Cancel launch
  async cancelLaunch(launchId: string) {
    return await apiService.request(`/creators/token/cancel-launch/${launchId}`, {
      method: 'POST',
    });
  }

  // Estimate cost - simplified to only use what's needed
  async estimateCost(config: { 
    botCount: number; 
    creatorBuyAmount: number; 
    botBuyAmount: number; 
    useJitoBundle?: boolean;
    atomicMode?: boolean; // Add this
  }): Promise<CostEstimation> {
    // Ensure minimum values
    const safeConfig = {
      bot_count: Math.max(config.botCount, 1),
      creator_buy_amount: Math.max(config.creatorBuyAmount, 0.001),
      bot_buy_amount: Math.max(config.botBuyAmount, 0.001),
      use_jito_bundle: config.useJitoBundle ?? true,
      atomic_mode: config.atomicMode ?? false, // Add this
    };
    
    console.log('Sending estimation config:', safeConfig);
    
    return await apiService.request('/creators/token/estimate-cost', {
      method: 'POST',
      body: JSON.stringify(safeConfig),
    });
  }

  // Get bot wallets
  // async getBotWallets() {
  //   return await apiService.request('/creators/user/bot-wallets');
  // }

  // Get bot wallets
  async getBotWallets(autoRefresh: boolean = true) {
    // Auto-refresh balances first if requested
    if (autoRefresh) {
      try {
        await apiService.request('/creators/user/refresh-bot-balances', {
          method: 'POST',
        });
        // Wait a moment for the refresh to complete
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.warn('Auto-refresh failed, using cached balances:', error);
      }
    }
    
    return await apiService.request('/creators/user/bot-wallets');
  }

  // Add this method to your TokenLaunchService class
  async refreshBotBalances() {
    return await apiService.request('/creators/user/refresh-bot-balances', {
      method: 'POST',
    });
  }

  // Add this method to your tokenLaunch.ts TokenLaunchService class
  async getBotPrivateKey(walletId: string | number, token: string) {
    // Ensure walletId is sent as a number (integer)
    const walletIdNum = typeof walletId === 'string' ? parseInt(walletId, 10) : walletId;
    
    return await apiService.request('/creators/user/get-bot-private-key', {
      method: 'POST',
      body: JSON.stringify({
        wallet_id: walletIdNum,  // Send as number
        private_key_token: token
      }),
    });
  }

  // Add to TokenLaunchService class
  async updateUserSettings(settings: {
    botCount?: number;
    botWalletBuyAmount?: number;
    creatorBuyAmount?: number;
    sellTiming?: 'volume-based' | 'time-based' | 'price-target' | 'immediate';
    sellVolumeTrigger?: number;
    sellTimeTrigger?: number;
    sellPriceTarget?: number;
  }) {
    return await apiService.request('/creators/user/update-settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  // Generate bot wallets
  async generateBotWallets(count: number = 5) {
    return await apiService.request('/creators/user/generate-bot-wallets', {
      method: 'POST',
      body: JSON.stringify({ count }),
    });
  }

  // Enable creator mode
  async enableCreatorMode() {
    return await apiService.request('/creators/user/enable-creator', {
      method: 'POST',
    });
  }

  // Disable creator mode
  async disableCreatorMode() {
    return await apiService.request('/creators/user/disable-creator', {
      method: 'POST',
    });
  }

  // Get creator stats
  async getCreatorStats() {
    return await apiService.request('/creators/user/stats');
  }

  // Get creator balance
  async getCreatorBalance() {
    return await apiService.request('/creators/user/balance');
  }

  // Get launch results (from your index.tsx usage)
  async getLaunchResults() {
    // This endpoint might not exist yet, but you can create it
    return await apiService.request('/creators/user/launch-history');
  }

  // Refresh user data
  async refreshUserData() {
    return {
      stats: await this.getCreatorStats(),
      botWallets: await this.getBotWallets(),
      balance: await this.getCreatorBalance(),
    };
  }

  // Pre-fund bot wallets
  async preFundBotWallets(request: PreFundRequest): Promise<PreFundResponse> {
    return await apiService.request('/creators/prefund/fund-bot-wallets', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Get pre-funded bot wallets
  async getPreFundedBots(): Promise<BotWalletStatus[]> {
    return await apiService.request('/creators/prefund/get-funded-bot-wallets');
  }

  // Reset pre-funding for a bot
  async resetBotPreFunding(botId: number) {
    return await apiService.request(`/creators/prefund/reset/${botId}`, {
      method: 'POST',
    });
  }

  // Execute atomic launch
  async executeAtomicLaunch(request: AtomicLaunchRequest): Promise<AtomicLaunchResponse> {
    return await apiService.request('/creators/token/atomic-launch', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Add this method to your TokenLaunchService class
  async executeAtomicCreateAndBuy(payload: {
    user_wallet: string;
    metadata: {
      name: string;
      symbol: string;
      description: string;
      image: string;
    };
    creator_buy_amount: number;
    bot_wallets: Array<{
      public_key: string;
      buy_amount: number;
    }>;
    use_jito: boolean;
    atomic_bundle: boolean;
    sell_strategy: {
      type: string;
      volume_target: number;
      time_minutes: number;
      price_target: number;
    };
  }): Promise<{
    success: boolean;
    launch_id: string;
    message: string;
    atomic_bundle: boolean;
    error?: string;
  }> {
    return await apiService.request('/creators/token/atomic-create-and-buy', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Orchestrated launch (auto pre-fund + atomic launch)
  async startOrchestratedLaunch(): Promise<AtomicLaunchResponse> {
    return await apiService.request('/creators/token/orchestrated-launch', {
      method: 'POST',
    });
  }

  // Add method to check if bots are pre-funded
  // async checkPreFundedStatus(): Promise<{
  //   has_pre_funded: boolean;
  //   count: number;
  //   total_amount: number;
  // }> {
  //   try {
  //     const bots = await this.getPreFundedBots();
  //     const preFundedBots = bots.filter(bot => bot.is_pre_funded);

  //     return {
  //       has_pre_funded: preFundedBots.length > 0,
  //       count: preFundedBots.length,
  //       total_amount: preFundedBots.reduce((sum, bot) => sum + (bot.pre_funded_amount || 0), 0)
  //     };
  //   } catch (error) {
  //     return {
  //       has_pre_funded: false,
  //       count: 0,
  //       total_amount: 0
  //     }
  //   }
  // }

  // services/tokenLaunch.ts - Update with proper types
  async checkPreFundedStatus(): Promise<{
    has_pre_funded: boolean;
    count: number;
    total_amount: number;
  }> {
    try {
      // First get ALL bot wallets with proper typing
      const allBotsResponse = await this.getBotWallets(false); // Don't auto-refresh
      const allBots: BotWallet[] = allBotsResponse.bot_wallets || [];
      
      // Count bots with actual balance > 0 (not just database flag)
      const preFundedBots = allBots.filter((bot: BotWallet) => {
        const hasBalance = (bot.current_balance || 0) > 0;
        const hasPreFundFlag = bot.is_pre_funded || false;
        return hasBalance || hasPreFundFlag;
      });

      return {
        has_pre_funded: preFundedBots.length > 0,
        count: preFundedBots.length,
        total_amount: preFundedBots.reduce((sum: number, bot: BotWallet) => 
          sum + (bot.pre_funded_amount || bot.current_balance || 0), 0
        )
      };
    } catch (error) {
      console.error('Failed to check pre-funded bots:', error);
      return { has_pre_funded: false, count: 0, total_amount: 0 };
    }
  }
  
}

export const tokenLaunchService = new TokenLaunchService();

