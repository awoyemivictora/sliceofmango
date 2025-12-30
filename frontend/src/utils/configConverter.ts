import { LaunchConfig } from '@/services/tokenLaunch';

export interface BackendLaunchConfig {
  use_ai_metadata?: boolean;
  custom_metadata?: any;
  bot_count?: number;
  creator_buy_amount?: number;
  bot_buy_amount?: number;
  sell_strategy_type?: 'volume_based' | 'time_based' | 'price_target';
  sell_volume_target?: number;
  sell_price_target?: number;
  sell_time_minutes?: number;
  metadata_style?: string;
  use_jito_bundle?: boolean;
  priority?: number;
}

export const convertToBackendConfig = (
    config: LaunchConfig,
    atomicLaunchMode?: boolean
): any => {
  return {
    // Core token info
    token_name: config.tokenName,
    token_symbol: config.tokenSymbol,
    token_description: config.tokenDescription,
    image_url: config.imageUrl,
    creator_wallet: config.creatorWallet,
    
    // Bot configuration
    bot_count: config.botCount,
    bot_wallet_buy_amount: config.botWalletBuyAmount,
    creator_buy_amount: config.creatorBuyAmount,
    
    // Strategy
    target_profit_percentage: config.targetProfitPercentage,
    sell_timing: config.sellTiming,
    sell_volume_trigger: config.sellVolumeTrigger,
    sell_time_trigger: config.sellTimeTrigger,
    sell_price_target: config.sellPriceTarget,
    
    // AI Metadata
    use_ai_for_metadata: config.useAIForMetadata,
    metadata_style: config.metadataStyle,
    metadata_keywords: config.metadataKeywords,
    use_dalle: config.useDalle,
    
    // Advanced settings
    initial_sol_reserves: config.initialSolReserves,
    use_jito_bundle: config.useJitoBundle,
    priority: config.priority,
    bot_spread: config.botSpread,
    
    // For atomic launch
    atomic_mode: atomicLaunchMode,
  };
};

export function getSellStrategyType(sellTiming?: string): 'volume_based' | 'time_based' | 'price_target' {
  if (!sellTiming) return 'volume_based';
  
  // Convert any format to backend format
  const timing = sellTiming.toLowerCase().replace('-', '_');
  
  if (timing === 'volume_based' || timing === 'volume') {
    return 'volume_based';
  } else if (timing === 'time_based' || timing === 'time') {
    return 'time_based';
  } else if (timing === 'price_target' || timing === 'price') {
    return 'price_target';
  }
  
  return 'volume_based';
}

// Helper to calculate pre-fund amount
export function calculatePreFundAmount(buyAmount: number, multiplier: number = 2): number {
  return buyAmount * multiplier;
}

// Helper to check if pre-funded bots are sufficient
export function hasSufficientPreFunded(
  preFundedBots: any[],
  requiredCount: number,
  requiredAmount: number
): boolean {
  if (preFundedBots.length < requiredCount) return false;
  
  const availableBots = preFundedBots
    .filter(bot => bot.is_pre_funded && bot.pre_funded_amount >= requiredAmount)
    .slice(0, requiredCount);
    
  return availableBots.length >= requiredCount;
}


